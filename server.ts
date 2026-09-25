import * as noise from "./signed_noise.ts";

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
  demo?: number; // demo rooms only: when they expire. Small, short, typing and browser speech only.
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
const DEEPGRAM_KEEPALIVE_MS = 5_000; // Deepgram drops a silent socket after ~10 s
const DEEPGRAM_DEFAULT_URL = "wss://api.deepgram.com/v1/listen";
const deepgramKey = () => Deno.env.get("DEEPGRAM_API_KEY") ?? "";
const deepgramUrl = () => Deno.env.get("DEEPGRAM_URL") ?? DEEPGRAM_DEFAULT_URL;
const deepgramModel = () => Deno.env.get("DEEPGRAM_MODEL") ?? "nova-3";
const PHONE_LOST_MS = 45_000;
// The live demo on /demo: every visitor gets a signed-noise room id that only becomes a room when a
// phone scans it. Set STAGETYPE_SECRET in production so demo QR codes survive a restart.
const SECRET = Deno.env.get("STAGETYPE_SECRET") ?? crypto.randomUUID() + crypto.randomUUID();
const DEMO_TTL_MS = 10 * 60_000;
const DEMO_MAX_ROOMS = 200;
const DEMO_MAX_LISTENERS = 3; // a live phone that goes this long without a push is treated as dropped

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

// The one way words enter a room. HTTP pushes and relay-side speech engines both come through here.
function pushChunk(room: Room, chunk: { text: string; final: boolean; source: Source }) {
  const text = chunk.text.trim().slice(0, MAX_CHUNK);
  room.touched = Date.now();
  if (chunk.source === "phone") { room.phone.seen = room.touched; setPhone(room, true, false); }
  if (chunk.final) {
    if (text) {
      room.lines.push(text);
      if (room.lines.length > MAX_BACKLOG) { room.lines.shift(); room.offset++; }
    }
    send(room, "final", { text, seq: room.offset + room.lines.length, source: chunk.source });
  } else {
    send(room, "interim", { text, source: chunk.source });
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
  if (room.code) codes.delete(room.code);
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
  if (get && path === "/demo") return file("demo.html", head);
  // Mint a demo id. Stateless: nothing exists until a phone opens the signed link.
  if (get && path === "/api/demo/mint") {
    const n = await noise.mint(SECRET, DEMO_TTL_MS, "d");
    return json({ id: n.id, sig: n.sig, exp: n.exp, token: await noise.derive(SECRET, n.id, "write") });
  }
  const demoStatus = path.match(/^\/api\/demo\/([a-z0-9]+)$/);
  if (get && demoStatus) {
    if (!await noise.verify(SECRET, demoStatus[1], url.searchParams.get("s"))) return json({ error: "not ours" }, 404);
    const r = rooms.get(demoStatus[1]);
    return json({ alive: !!r, listeners: r?.listeners.size ?? 0 });
  }
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
  if (get && path === "/deepgram.js") return file("deepgram.js", head, "text/javascript; charset=utf-8");
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

  // Which speech engines this relay offers. Browser recognition is always there; Deepgram needs a key.
  if (get && path === "/api/engines") return json({ browser: true, deepgram: deepgramKey() !== "" });

  // Relay-side speech: the page streams PCM over a WebSocket, the relay forwards it to Deepgram and
  // turns the results into ordinary room pushes. The token rides in the WebSocket subprotocol
  // ("bearer", <token>) because browsers can't set headers on a socket and a query string would be logged.
  const audio = path.match(/^\/api\/room\/([a-z0-9]+)\/audio$/);
  if (audio && req.method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const r = rooms.get(audio[1]);
    if (!r) return json({ error: "room gone" }, 404);
    const offered = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
    if (offered[0] !== "bearer" || !tokenOk(`Bearer ${offered[1] ?? ""}`, r.token)) return json({ error: "nope" }, 403);
    if (!deepgramKey()) return json({ error: "no speech engine on this relay" }, 503);
    if (r.demo) return json({ error: "not in the demo" }, 403);
    const { socket, response } = Deno.upgradeWebSocket(req, { protocol: "bearer" });
    const source: Source = url.searchParams.get("source") === "phone" ? "phone" : "mic";
    const lang = (url.searchParams.get("lang") ?? "en").match(/^[A-Za-z]{2,3}(-[A-Za-z]{2,8})*$/)?.[0] ?? "en";
    deepgramSession(r, socket, source, lang);
    return response;
  }

  const m = path.match(/^\/api\/room\/([a-z0-9]+)(\/stream)?$/);
  if (m && m[2] && req.method === "GET" && !rooms.has(m[1])) await materialiseDemo(m[1], url.searchParams.get("s"));
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
    const text = typeof body.text === "string" ? body.text : "";
    if (source === "phone" && body.ping) {
      // The phone says live:true when it starts and heartbeats it; live:false when the presenter pauses it.
      // Words from it (via pushChunk) also count as live. The console pauses the laptop mic on the change.
      room.phone.seen = now;
      setPhone(room, typeof body.live === "boolean" ? body.live : room.phone.live, false);
    }
    if (!body.ping) pushChunk(room, { text, final: !!body.final, source });
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
    if (room.listeners.size >= (room.demo ? DEMO_MAX_LISTENERS : MAX_LISTENERS)) return json({ error: "room full" }, 503);
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

// One client socket in, one Deepgram socket out. Deepgram sends interim results, then is_final
// segments, then speech_final at the end of an utterance; we show interims as they come, gather the
// finalised segments, and push one clean final line per utterance (or on UtteranceEnd).
function deepgramSession(room: Room, client: WebSocket, source: Source, lang: string) {
  const params = new URLSearchParams({
    model: deepgramModel(), language: lang, encoding: "linear16", sample_rate: "16000", channels: "1",
    interim_results: "true", smart_format: "true", punctuate: "true", endpointing: "300", utterance_end_ms: "1200", vad_events: "false",
  });
  const up = new WebSocket(`${deepgramUrl()}?${params}`, ["token", deepgramKey()]);
  up.binaryType = "arraybuffer";
  const pending: string[] = [];
  const queue: ArrayBuffer[] = []; // audio that arrived before Deepgram answered
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const tell = (msg: unknown) => { try { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg)); } catch { /* gone */ } };
  const finish = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    try { if (up.readyState === WebSocket.OPEN) up.send(JSON.stringify({ type: "CloseStream" })); } catch { /* gone */ }
    try { up.close(); } catch { /* gone */ }
    try { client.close(code, reason.slice(0, 120)); } catch { /* gone */ }
    if (!rooms.has(roomKey(room))) return;
    if (pending.length) flush(); else pushChunk(room, { text: "", final: false, source });
  };
  const flush = () => {
    const text = pending.join(" ").trim();
    pending.length = 0;
    if (text) { pushChunk(room, { text, final: true, source }); tell({ final: text }); }
    else { pushChunk(room, { text: "", final: false, source }); tell({ interim: "" }); }
  };
  up.onopen = () => {
    for (const buf of queue.splice(0)) up.send(buf);
    keepalive = setInterval(() => { try { up.send(JSON.stringify({ type: "KeepAlive" })); } catch { /* gone */ } }, DEEPGRAM_KEEPALIVE_MS);
    tell({ ready: true });
  };
  up.onmessage = (e) => {
    if (typeof e.data !== "string" || !rooms.has(roomKey(room))) return;
    let msg: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "UtteranceEnd") { flush(); return; }
    if (msg.type !== "Results") return;
    const t = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();
    if (msg.is_final) {
      if (t) pending.push(t);
      if (msg.speech_final) flush();
      else { const i = pending.join(" "); pushChunk(room, { text: i, final: false, source }); tell({ interim: i }); }
    } else {
      const i = [...pending, t].join(" ").trim();
      pushChunk(room, { text: i, final: false, source }); tell({ interim: i });
    }
  };
  up.onerror = () => { tell({ error: "The relay couldn't reach Deepgram." }); finish(1011, "upstream error"); };
  up.onclose = (e) => { if (!closed) { tell({ error: e.reason || "Deepgram closed the stream." }); finish(1011, e.reason); } };
  client.onmessage = (e) => {
    if (typeof e.data === "string") { try { if (JSON.parse(e.data)?.type === "stop") finish(); } catch { /* ignore */ } return; }
    const buf = e.data as ArrayBuffer;
    if (up.readyState === WebSocket.OPEN) up.send(buf); else if (queue.length < 200) queue.push(buf);
  };
  client.onclose = () => finish();
  client.onerror = () => finish(1011, "client error");
}
const roomKey = (room: Room) => { for (const [k, r] of rooms) if (r === room) return k; return ""; };

// The first scan of a signed demo link turns noise into a room. The write token is derived from the
// id, so the page that minted it can type into the room without the server ever having stored it.
async function materialiseDemo(id: string, sig: string | null) {
  const exp = await noise.verify(SECRET, id, sig);
  if (!exp || rooms.has(id)) return;
  let demos = 0;
  for (const r of rooms.values()) if (r.demo) demos++;
  if (demos >= DEMO_MAX_ROOMS || rooms.size >= MAX_ROOMS) return;
  const now = Date.now();
  rooms.set(id, {
    token: await noise.derive(SECRET, id, "write"), code: "", title: "StageType demo",
    lines: [], offset: 0, phone: { live: false, seen: 0 }, listeners: new Set(), touched: now, startedAt: now, demo: exp,
  });
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
    if (now - r.touched > ROOM_TTL_MS || (r.demo && now > r.demo)) endRoom(k, r);
  }
}

const PORT = Number(Deno.env.get("PORT") ?? 8787);

if (import.meta.main) {
  setInterval(sweep, 60_000);
  setInterval(checkPhones, 5_000);
  setInterval(() => sweep(), 15_000); // demo rooms expire on the minute, not the half hour
  Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
  console.log(`presenter: http://localhost:${PORT}   phones: http://${lanIp()}:${PORT}`);
}
