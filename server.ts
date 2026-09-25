// StageType: one presenter speaks, many phones read along.
// Zero deps. Rooms live in memory; a restart ends every talk.
// ponytail: single-process in-memory rooms, move to Deno KV/Redis only if this ever runs on >1 instance.

type Chunk = { text?: unknown; final?: unknown; ping?: unknown; source?: unknown; live?: unknown };
type Source = "mic" | "phone" | "typed";
const SOURCES = new Set<string>(["mic", "phone", "typed"]);
type Listener = { ctrl: ReadableStreamDefaultController<Uint8Array>; ping: ReturnType<typeof setInterval> };
type Room = {
  token: string;
  code: string; // four-letter join code people can type instead of scanning
  title: string; // shown on every phone and in the export; "" when the presenter left it blank
  lines: string[]; // finalized sentences, the backlog late joiners get
  offset: number; // how many lines have been shifted out of `lines` (so seq = offset + index)
  phone: { live: boolean; seen: number }; // the lapel mic: live while it heartbeats, lost after PHONE_LOST_MS
  listeners: Set<Listener>;
  touched: number;
  startedAt: number;
};

const ROOM_TTL_MS = 30 * 60_000; // idle rooms vanish after 30 min (presenter keepalive extends it)
const MAX_ROOMS = 1_000;
const MAX_LISTENERS = 500;
const MAX_BACKLOG = 400;
const MAX_CHUNK = 2_000; // chars kept per final line
const MAX_TITLE = 80;
const MAX_BODY = 16_384; // bytes accepted per push
const PING_MS = 20_000;
const PHONE_LOST_MS = 45_000; // a live phone that goes this long without a push is treated as dropped

export const rooms = new Map<string, Room>();
const codes = new Map<string, string>(); // join code -> room id, only while the room is open
const enc = new TextEncoder();
const dec = new TextDecoder();

const id = (n: number) => crypto.randomUUID().replaceAll("-", "").slice(0, n);

// Join codes: four letters from an alphabet without I, O and Q (nothing that reads as a digit or
// each other on a projector), skipping the words nobody wants on a lecture screen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ";
const CODE_BLOCKLIST = new Set(["FUCK","SHIT","CUNT","DAMN","DICK","COCK","TWAT","ANAL","ARSE","BUTT","CRAP","JERK","NAZI","RAPE","SLUT","SUCK","TITS","WANK","PISS","CUMS","KIKE","SPIC","DAGO","PAKI","HOMO","FAGS","DYKE","JIZZ","MUFF","PUBE","POOP","PORN","SCUM","SEXY","TURD","HELL","KILL","DEAD","GOOK","COON","CHNK","FART","BUMS","NUTS","DUMB","LAME","HATE"]);
export function newCode(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const c = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!CODE_BLOCKLIST.has(c) && !codes.has(c)) return c;
  }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Constant-time compare so a token can't be guessed a byte at a time from response timing.
function tokenOk(header: string | null, token: string): boolean {
  const a = enc.encode(header ?? "");
  const b = enc.encode(`Bearer ${token}`);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function frame(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function drop(room: Room, l: Listener) {
  clearInterval(l.ping);
  room.listeners.delete(l);
}

function send(room: Room, event: string, data: unknown) {
  const f = frame(event, data);
  for (const l of room.listeners) {
    try { l.ctrl.enqueue(f); } catch { drop(room, l); }
  }
}

function setPhone(room: Room, live: boolean, lost: boolean) {
  if (room.phone.live === live) return;
  room.phone.live = live;
  send(room, "source", { source: "phone", live, lost });
}

// Runs every few seconds: a phone that stopped heartbeating (battery, lock screen, walked out of wifi)
// is marked lost so the console can bring the laptop mic back.
export function checkPhones(now = Date.now()) {
  for (const r of rooms.values()) {
    if (r.phone.live && now - r.phone.seen > PHONE_LOST_MS) setPhone(r, false, true);
  }
}

function endRoom(key: string, room: Room) {
  send(room, "end", { lines: room.lines, startedAt: room.startedAt, endedAt: Date.now() });
  for (const l of room.listeners) {
    try { l.ctrl.close(); } catch { /* already gone */ }
    drop(room, l);
  }
  codes.delete(room.code);
  rooms.delete(key);
}

// Prefer a real LAN address (192.168.x, 10.x, 172.16-31.x) on a physical-looking interface
// over Docker bridges, VPN tunnels and the like, so the audience QR points somewhere phones can reach.
export function lanIp(): string {
  try {
    const rfc1918 = (a: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
    const physical = (n: string) => /^(en|eth|wl|wlan|wlp|enp)/.test(n);
    const candidates = Deno.networkInterfaces()
      .filter((i) => i.family === "IPv4" && !i.address.startsWith("127.") && !i.address.startsWith("169.254."))
      .sort((a, b) => score(b) - score(a));
    function score(i: Deno.NetworkInterfaceInfo) {
      return (rfc1918(i.address) ? 2 : 0) + (physical(i.name) ? 1 : 0) - (/^(docker|br-|veth|utun|tun|tap|vmnet|virbr)/.test(i.name) ? 4 : 0);
    }
    return candidates[0]?.address ?? "localhost";
  } catch { return "localhost"; }
}

const isLoopbackHost = (req: Request) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.get("host") ?? "");

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const get = req.method === "GET" || req.method === "HEAD";
  const head = req.method === "HEAD";

  // Pages + the one vendored asset (QR encoder), so the console works on a venue LAN with no internet.
  if (get && path === "/") return file("presenter.html", head);
  if (get && /^\/live\/[a-z0-9]+$/.test(path)) return file("audience.html", head);
  // Phone as the mic: the write token rides in the URL #fragment, which browsers never send to the server
  if (get && /^\/mic\/[a-z0-9]+$/.test(path)) return file("mic.html", head);
  // The bar on its own: any second screen, or an OBS browser source for a livestream
  if (get && /^\/ticker\/[a-z0-9]+$/.test(path)) return file("ticker.html", head);
  // Type-the-code entry for people who can't scan the projector
  if (get && (path === "/join" || path === "/live" || path === "/live/")) return file("join.html", head);
  if (get && /^\/j\/[A-Za-z]{4}$/.test(path)) {
    const code = path.slice(3).toUpperCase();
    const roomId = codes.get(code);
    return Response.redirect(new URL(roomId ? `/live/${roomId}` : `/join?nope=${code}`, url), 302);
  }
  if (get && /^\/api\/join\/[A-Za-z]{4}$/.test(path)) {
    const roomId = codes.get(path.slice(10).toUpperCase());
    return roomId ? json({ id: roomId }) : json({ error: "no talk with that code" }, 404);
  }
  // Vendored assets: the QR encoder, the curated fonts and their stylesheet. Strict allowlist of names, long cache.
  if (get && /^\/vendor\/(fonts\/)?[a-z0-9-]+\.(js|css|woff2)$/.test(path)) {
    const type = path.endsWith(".js") ? "text/javascript; charset=utf-8" : path.endsWith(".css") ? "text/css; charset=utf-8" : "font/woff2";
    return file(path.slice(1), head, type, true);
  }
  if (get && (path === "/ghost.svg" || path === "/favicon.ico")) return file("ghost.svg", head, "image/svg+xml");
  // Only answer the LAN address to a browser on this machine; nobody else needs the internal IP.
  if (get && path === "/api/info") {
    return isLoopbackHost(req) ? json({ lan: `http://${lanIp()}:${PORT}` }) : json({ error: "local only" }, 404);
  }

  // Presenter opens a room, optionally with a title
  if (req.method === "POST" && path === "/api/room") {
    if (rooms.size >= MAX_ROOMS) return json({ error: "server full" }, 503);
    const raw = await readBody(req);
    if (raw === null) return json({ error: "too big" }, 413);
    let opts: { title?: unknown } = {};
    if (raw.trim()) { try { opts = JSON.parse(raw) ?? {}; } catch { return json({ error: "bad json" }, 400); } }
    const title = typeof opts.title === "string" ? opts.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
    const roomId = id(8);
    const token = id(32);
    const code = newCode();
    const now = Date.now();
    rooms.set(roomId, { token, code, title, lines: [], offset: 0, phone: { live: false, seen: 0 }, listeners: new Set(), touched: now, startedAt: now });
    codes.set(code, roomId);
    return json({ id: roomId, token, title, code });
  }

  const m = path.match(/^\/api\/room\/([a-z0-9]+)(\/stream)?$/);
  const room = m ? rooms.get(m[1]) : undefined;
  if (m && !room) return json({ error: "room gone" }, 404);

  // Presenter pushes a chunk (or a bare keepalive while paused)
  if (room && !m![2] && req.method === "POST") {
    if (!tokenOk(req.headers.get("authorization"), room.token)) return json({ error: "nope" }, 403);
    const raw = await readBody(req);
    if (raw === null) return json({ error: "too big" }, 413);
    let body: Chunk | null = null;
    try { body = JSON.parse(raw); } catch { /* fallthrough */ }
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
    const now = Date.now();
    room.touched = now;
    const source: Source = typeof body.source === "string" && SOURCES.has(body.source) ? body.source as Source : "mic";
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHUNK) : "";
    if (source === "phone") {
      // The phone says live:true when it starts and heartbeats it; live:false when the presenter pauses it.
      // Any words from it also count as live. The console pauses the laptop mic on the change.
      room.phone.seen = now;
      const wants = typeof body.live === "boolean" ? body.live : (body.ping ? room.phone.live : true);
      setPhone(room, wants, false);
    }
    if (body.ping) {
      // keepalive only
    } else if (body.final) {
      if (text) {
        room.lines.push(text);
        if (room.lines.length > MAX_BACKLOG) { room.lines.shift(); room.offset++; }
      }
      send(room, "final", { text, seq: room.offset + room.lines.length, source });
    } else {
      send(room, "interim", { text, source });
    }
    return json({ ok: true, listeners: room.listeners.size, lineCount: room.offset + room.lines.length, title: room.title });
  }

  // Presenter ends the talk
  if (room && !m![2] && req.method === "DELETE") {
    if (!tokenOk(req.headers.get("authorization"), room.token)) return json({ error: "nope" }, 403);
    endRoom(m![1], room);
    return json({ ok: true });
  }

  // Audience listens (SSE; EventSource reconnects on its own)
  if (room && m![2] && req.method === "GET") {
    if (room.listeners.size >= MAX_LISTENERS) return json({ error: "room full" }, 503);
    let me: Listener;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const hello = frame("backlog", { lines: room.lines, offset: room.offset, startedAt: room.startedAt, title: room.title, phone: room.phone.live });
        c.enqueue(enc.encode(`retry: 2000\n${dec.decode(hello)}`));
        const ping = setInterval(() => {
          try { c.enqueue(enc.encode(": ping\n\n")); } catch { drop(room, me); }
        }, PING_MS);
        me = { ctrl: c, ping };
        room.listeners.add(me);
      },
      cancel() { drop(room, me); },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    });
  }

  return new Response("not here", { status: 404 });
}

// Read a request body up to MAX_BODY bytes; null when it is larger.
async function readBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return null;
  if (!req.body) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > MAX_BODY) { await req.body.cancel().catch(() => {}); return null; }
    parts.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return dec.decode(out);
}

async function file(name: string, isHead = false, type = "text/html; charset=utf-8", immutable = false) {
  let body: Uint8Array<ArrayBuffer> | null = null;
  if (!isHead) {
    try { body = await Deno.readFile(new URL(name, import.meta.url)); } catch { return new Response("not here", { status: 404 }); }
  }
  return new Response(body, {
    headers: {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}

export function sweep(now = Date.now()) {
  for (const [k, r] of rooms) {
    if (now - r.touched > ROOM_TTL_MS) endRoom(k, r);
  }
}

const PORT = Number(Deno.env.get("PORT") ?? 8787);

if (import.meta.main) {
  setInterval(sweep, 60_000);
  setInterval(checkPhones, 5_000);
  Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
  console.log(`presenter: http://localhost:${PORT}   phones: http://${lanIp()}:${PORT}`);
}
