// talktype-live: one presenter speaks, many phones read along.
// Zero deps. Rooms live in memory; a restart ends every talk.
// ponytail: single-process in-memory rooms, move to Deno KV/Redis only if this ever runs on >1 instance.

type Line = { text: string; final: boolean };
type Room = {
  token: string;
  lines: string[]; // finalized sentences, the backlog late joiners get
  listeners: Set<ReadableStreamDefaultController<Uint8Array>>;
  touched: number;
  startedAt: number;
};

const ROOM_TTL_MS = 30 * 60_000; // idle rooms vanish after 30 min
const MAX_LISTENERS = 500;
const MAX_BACKLOG = 400;
const MAX_CHUNK = 2_000;

export const rooms = new Map<string, Room>();
const enc = new TextEncoder();

const id = (n: number) => crypto.randomUUID().replaceAll("-", "").slice(0, n);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function send(room: Room, event: string, data: unknown) {
  const frame = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const c of room.listeners) {
    try { c.enqueue(frame); } catch { room.listeners.delete(c); }
  }
}

function lanIp(): string {
  try {
    return Deno.networkInterfaces().find((i) => i.family === "IPv4" && !i.address.startsWith("127."))?.address ?? "localhost";
  } catch { return "localhost"; }
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Pages
  if ((req.method === "GET" || req.method === "HEAD") && path === "/") return file("presenter.html", req.method === "HEAD");
  if ((req.method === "GET" || req.method === "HEAD") && /^\/live\/[a-z0-9]+$/.test(path)) return file("audience.html", req.method === "HEAD");
  // Phone as the mic: the write token rides in the URL #fragment, which browsers never send to the server
  if ((req.method === "GET" || req.method === "HEAD") && /^\/mic\/[a-z0-9]+$/.test(path)) return file("mic.html", req.method === "HEAD");
  if ((req.method === "GET" || req.method === "HEAD") && path === "/api/info") return json({ lan: `http://${lanIp()}:${PORT}` });

  // Presenter opens a room
  if (req.method === "POST" && path === "/api/room") {
    const roomId = id(8);
    const token = id(32);
    const now = Date.now();
    rooms.set(roomId, { token, lines: [], listeners: new Set(), touched: now, startedAt: now });
    return json({ id: roomId, token });
  }

  const m = path.match(/^\/api\/room\/([a-z0-9]+)(\/stream)?$/);
  const room = m ? rooms.get(m[1]) : undefined;
  if (m && !room) return json({ error: "room gone" }, 404);

  // Presenter pushes a chunk
  if (room && !m![2] && req.method === "POST") {
    if (req.headers.get("authorization") !== `Bearer ${room.token}`) return json({ error: "nope" }, 403);
    const body = await req.json().catch(() => null) as Line | null;
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_CHUNK) : "";
    room.touched = Date.now();
    if (body?.final) {
      if (text) {
        room.lines.push(text);
        if (room.lines.length > MAX_BACKLOG) room.lines.shift();
      }
      send(room, "final", { text, count: room.lines.length });
    } else {
      send(room, "interim", { text });
    }
    return json({ ok: true, listeners: room.listeners.size, lineCount: room.lines.length });
  }

  // Presenter ends the talk
  if (room && !m![2] && req.method === "DELETE") {
    if (req.headers.get("authorization") !== `Bearer ${room.token}`) return json({ error: "nope" }, 403);
    send(room, "end", { lines: room.lines, startedAt: room.startedAt, endedAt: Date.now() });
    for (const c of room.listeners) try { c.close(); } catch { /* already gone */ }
    rooms.delete(m![1]);
    return json({ ok: true });
  }

  // Audience listens (SSE; EventSource reconnects on its own)
  if (room && m![2] && req.method === "GET") {
    if (room.listeners.size >= MAX_LISTENERS) return json({ error: "room full" }, 503);
    let ctrl: ReadableStreamDefaultController<Uint8Array>;
    let ping: ReturnType<typeof setInterval>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        room.listeners.add(c);
        c.enqueue(enc.encode(`retry: 2000\nevent: backlog\ndata: ${JSON.stringify({ lines: room.lines, startedAt: room.startedAt })}\n\n`));
        ping = setInterval(() => { try { c.enqueue(enc.encode(": ping\n\n")); } catch { clearInterval(ping); } }, 20_000);
      },
      cancel() { clearInterval(ping); room.listeners.delete(ctrl); },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    });
  }

  return new Response("not here", { status: 404 });
}

async function file(name: string, isHead = false) {
  const body = isHead ? null : await Deno.readFile(new URL(name, import.meta.url));
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export function sweep(now = Date.now()) {
  for (const [k, r] of rooms) {
    if (now - r.touched > ROOM_TTL_MS) {
      send(r, "end", {});
      for (const c of r.listeners) try { c.close(); } catch { /* gone */ }
      rooms.delete(k);
    }
  }
}

const PORT = Number(Deno.env.get("PORT") ?? 8787);

if (import.meta.main) {
  setInterval(sweep, 60_000);
  Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
  console.log(`presenter: http://localhost:${PORT}   phones: http://${lanIp()}:${PORT}`);
}
