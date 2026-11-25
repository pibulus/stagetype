import {
  checkPhones,
  cleanLinks,
  cleanSpeaker,
  handler,
  keytermsFrom,
  lanIp,
  newCode,
  rooms,
  sameToken,
  sniffImageType,
  sweep,
} from "./server.ts";
import { cleanTranscriptLine, parseMicTarget, postLocalLine } from "./scripts/listen-local.ts";
import { mockDeepgram } from "./e2e/mock_deepgram.ts";

import { assert, assertEquals, assertThrows } from "@std/assert";

// Valid minimal image magic headers for asset tests
const FAKE_WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

const base = "http://x";
const post = (
  path: string,
  body?: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {},
  info?: Deno.ServeHandlerInfo,
) =>
  handler(
    new Request(base + path, {
      method: "POST",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    }),
    info,
  );
const fromAddr = (hostname: string): Deno.ServeHandlerInfo => ({
  remoteAddr: { transport: "tcp", hostname, port: 4321 },
  completed: Promise.resolve(),
});
const del = (path: string, token: string) =>
  handler(new Request(base + path, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }));
const openStream = async (id: string) => {
  const res = await handler(new Request(`${base}/api/room/${id}/stream`));
  const reader = res.body!.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  return { res, reader, read };
};
const mkRoom = async () => (await (await post("/api/room")).json()) as { id: string; token: string };

Deno.test("room lifecycle: create, auth, backlog, stream, end, ttl", async () => {
  const { id, token } = await mkRoom();

  assertEquals((await post(`/api/room/${id}`, { text: "hi", final: true }, "wrong")).status, 403);
  assertEquals((await post(`/api/room/${id}`, { text: "hello world", final: true }, token)).status, 200);
  await post(`/api/room/${id}`, { text: "typing…", final: false }, token); // interim, not kept
  assertEquals(rooms.get(id)!.lines, ["hello world"]);

  // late joiner gets the backlog first, with the reconnect hint in the same chunk
  const { reader, read } = await openStream(id);
  const first = await read();
  assert(first.startsWith("retry: 2000\n"));
  assert(first.includes("event: backlog") && first.includes("hello world") && first.includes('"offset":0'));

  // live chunk reaches the listener, carrying its sequence number
  await post(`/api/room/${id}`, { text: "second line", final: true }, token);
  const next = await read();
  assert(next.includes("event: final") && next.includes("second line") && next.includes('"seq":2'));
  await reader.cancel();
  assertEquals(rooms.get(id)!.listeners.size, 0);

  // idle rooms get swept
  sweep(Date.now() + 31 * 60_000);
  assertEquals(rooms.has(id), false);
  assertEquals((await handler(new Request(`${base}/api/room/${id}/stream`))).status, 404);
});

Deno.test("room carries a trimmed title", async () => {
  const r = await (await post("/api/room", { title: "  COMP1010   Week 3 " + "x".repeat(200) })).json();
  assert(r.title.startsWith("COMP1010 Week 3 x") && r.title.length === 80);
  const s = await openStream(r.id);
  assert((await s.read()).includes('"title":"COMP1010 Week 3'));
  await s.reader.cancel();
  const echo = await (await post(`/api/room/${r.id}`, { text: "hi", final: true }, r.token)).json();
  assertEquals(echo.title, r.title);
  await del(`/api/room/${r.id}`, r.token);
  const d = await mkRoom() as { id: string; token: string; title: string };
  assertEquals(d.title, "");
  await del(`/api/room/${d.id}`, d.token);
});

Deno.test("join codes: four safe letters, resolvable, redirecting, released on end", async () => {
  for (let i = 0; i < 200; i++) assert(/^[ABCDEFGHJKLMNPRSTUVWXYZ]{4}$/.test(newCode()));
  const r = await mkRoom() as { id: string; token: string; code: string };
  assert(/^[A-Z]{4}$/.test(r.code));
  assertEquals((await (await handler(new Request(`${base}/api/join/${r.code.toLowerCase()}`))).json()).id, r.id);
  const redir = await handler(new Request(`${base}/j/${r.code}`));
  assertEquals(redir.status, 302);
  assertEquals(redir.headers.get("location"), `/live/${r.id}`);
  await del(`/api/room/${r.id}`, r.token);
  assertEquals((await handler(new Request(`${base}/api/join/${r.code}`))).status, 404);
  const gone = await handler(new Request(`${base}/j/${r.code}`));
  assertEquals(gone.status, 302);
  assertEquals(gone.headers.get("location"), `/join?nope=${r.code}`);
  assertEquals((await handler(new Request(`${base}/join`))).status, 200);
  const liveRedir = await handler(new Request(`${base}/live`));
  assertEquals(liveRedir.status, 301);
  assertEquals(liveRedir.headers.get("location"), "/join");
  const liveSlashRedir = await handler(new Request(`${base}/live/`));
  assertEquals(liveSlashRedir.status, 301);
  assertEquals(liveSlashRedir.headers.get("location"), "/join");
});

Deno.test("phone handoff: source tags, live/paused announcements, lost detection", async () => {
  const { id, token } = await mkRoom();
  const s = await openStream(id);
  assert((await s.read()).includes('"phone":false'));
  // laptop words carry their source; an unknown source falls back to mic
  await post(`/api/room/${id}`, { text: "from laptop", final: true, source: "bogus" }, token);
  assert((await s.read()).includes('"source":"mic"'));
  await post(`/api/room/${id}`, { text: "typed", final: true, source: "typed" }, token);
  assert((await s.read()).includes('"source":"typed"'));
  // phone goes live: one announcement, not one per heartbeat
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: true }, token);
  const ann = await s.read();
  assert(ann.includes("event: source") && ann.includes('"live":true') && ann.includes('"lost":false'));
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: true }, token);
  await post(`/api/room/${id}`, { text: "from phone", final: true, source: "phone" }, token);
  const words = await s.read();
  assert(words.includes("event: final") && words.includes('"source":"phone"') && !words.includes("event: source"));
  assertEquals(rooms.get(id)!.phone.live, true);
  // presenter pauses the phone
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: false }, token);
  const off = await s.read();
  assert(off.includes("event: source") && off.includes('"live":false') && off.includes('"lost":false'));
  // words from the phone imply live again; then it goes quiet for too long and is marked lost
  await post(`/api/room/${id}`, { text: "back", final: true, source: "phone" }, token);
  const back = await s.read();
  assert(back.includes("event: source") && back.includes('"live":true'));
  assert((await s.read()).includes('"text":"back"'));
  checkPhones(Date.now() + 10_000);
  assertEquals(rooms.get(id)!.phone.live, true);
  checkPhones(Date.now() + 60_000);
  assertEquals(rooms.get(id)!.phone.live, false);
  const lost = (await s.read()) + "";
  assert(lost.includes("event: source") && lost.includes('"lost":true'));
  // a late-joining console learns the phone state from the backlog
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: true }, token);
  const s2 = await openStream(id);
  assert((await s2.read()).includes('"phone":true'));
  await s.reader.cancel();
  await s2.reader.cancel();
  await del(`/api/room/${id}`, token);
});

Deno.test("engines: Deepgram is offered only when the relay has a key", async () => {
  Deno.env.delete("DEEPGRAM_API_KEY");
  assertEquals(await (await handler(new Request(`${base}/api/engines`))).json(), { browser: true, deepgram: false });
  Deno.env.set("DEEPGRAM_API_KEY", "x");
  assertEquals(await (await handler(new Request(`${base}/api/engines`))).json(), { browser: true, deepgram: true });
  Deno.env.delete("DEEPGRAM_API_KEY");
});

Deno.test({
  name: "deepgram session: audio in, ordinary room pushes out, clean close",
  sanitizeOps: false,
  sanitizeResources: false, // real sockets on both sides; everything is closed below
  async fn() {
    const dg = mockDeepgram(0);
    Deno.env.set("DEEPGRAM_URL", `ws://localhost:${dg.addr.port}/listen`);
    Deno.env.set("DEEPGRAM_API_KEY", "test-key");
    const relay = Deno.serve({ port: 0, onListen() {} }, handler);
    const origin = `ws://localhost:${relay.addr.port}`;
    const { id, token } = await mkRoom();
    const s = await openStream(id);
    await s.read();
    let sse = "";
    const until = async (needle: string) => {
      while (!sse.includes(needle)) sse += await s.read();
    };

    // wrong token: the handshake is refused
    const bad = new WebSocket(`${origin}/api/room/${id}/audio`, ["bearer", "nope"]);
    await new Promise<void>((r) => {
      bad.onclose = () => r();
      bad.onerror = () => {};
    });

    const ws = new WebSocket(`${origin}/api/room/${id}/audio?source=mic&lang=en-AU&keyterm=Pibulus&keyterm=SoftStack`, ["bearer", token]);
    ws.binaryType = "arraybuffer";
    const got: string[] = [];
    ws.onmessage = (e) => got.push(String(e.data));
    await new Promise<void>((r) => {
      ws.onopen = () => r();
    });
    const queries = (dg as unknown as { queries: string[] }).queries;
    for (let i = 0; i < 50 && queries.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const upstream = queries.at(-1) ?? "";
    assert(upstream.includes("keyterm=Pibulus") && upstream.includes("keyterm=SoftStack"), "the names reach Deepgram: " + upstream);
    while (!got.some((g) => g.includes("ready"))) await new Promise((r) => setTimeout(r, 10));
    const chunk = new Int16Array(1600).buffer;
    for (let i = 0; i < 6; i++) ws.send(chunk);
    await until('"text":"Hello from the relay."');
    assert(sse.includes('event: interim\ndata: {"text":"Hello from","source":"mic"}'));
    assert(sse.includes('event: final\ndata: {"text":"Hello from the relay.","seq":1,"source":"mic"}'));
    assertEquals(rooms.get(id)!.lines, ["Hello from the relay."]);
    for (let i = 0; i < 6; i++) ws.send(chunk);
    await until('"text":"Second line","seq":2');
    assert(sse.includes('event: interim\ndata: {"text":"Second line","source":"mic"}'), "finalised-but-open segment shows as interim");
    assertEquals(rooms.get(id)!.lines, ["Hello from the relay.", "Second line"]);
    while (!got.some((g) => g.includes('"final":"Second line"'))) await new Promise((r) => setTimeout(r, 10)); // its own socket, its own timing

    ws.send(JSON.stringify({ type: "stop" }));
    await new Promise<void>((r) => {
      ws.onclose = () => r();
    });

    await s.reader.cancel();
    await del(`/api/room/${id}`, token);
    Deno.env.delete("DEEPGRAM_API_KEY");
    Deno.env.delete("DEEPGRAM_URL");
    await relay.shutdown();
    await dg.shutdown();
  },
});

Deno.test({
  name: "deepgram sessions are capped per room, and a closed slot frees up",
  sanitizeOps: false,
  sanitizeResources: false, // real sockets on both sides; everything is closed below
  async fn() {
    const dg = mockDeepgram(0);
    Deno.env.set("DEEPGRAM_URL", `ws://localhost:${dg.addr.port}/listen`);
    Deno.env.set("DEEPGRAM_API_KEY", "test-key");
    const relay = Deno.serve({ port: 0, onListen() {} }, handler);
    const origin = `ws://localhost:${relay.addr.port}`;
    const { id, token } = await mkRoom();

    const openSession = async () => {
      const ws = new WebSocket(`${origin}/api/room/${id}/audio?source=mic`, ["bearer", token]);
      const got: string[] = [];
      ws.onmessage = (e) => got.push(String(e.data));
      await new Promise<void>((r) => {
        ws.onopen = () => r();
        ws.onerror = () => r();
      });
      while (ws.readyState === WebSocket.OPEN && !got.some((g) => g.includes("ready"))) {
        await new Promise((r) => setTimeout(r, 10));
      }
      return { ws, ready: got.some((g) => g.includes("ready")) };
    };
    const closeSession = (ws: WebSocket) =>
      new Promise<void>((r) => {
        ws.onclose = () => r();
        ws.close();
      });

    const first = await openSession();
    const second = await openSession();
    assert(first.ready && second.ready, "the per-room budget allows two concurrent sessions");

    const third = await openSession();
    assert(!third.ready, "a third session on the same room is refused at capacity");
    assertEquals(third.ws.readyState, WebSocket.CLOSED);

    await closeSession(first.ws);
    const fourth = await openSession();
    assert(fourth.ready, "closing a session frees its slot for the next one");

    await closeSession(second.ws);
    await closeSession(fourth.ws);
    await del(`/api/room/${id}`, token);
    Deno.env.delete("DEEPGRAM_API_KEY");
    Deno.env.delete("DEEPGRAM_URL");
    await relay.shutdown();
    await dg.shutdown();
  },
});

Deno.test("ending a talk closes every listener and clears its keepalive timer", async () => {
  const { id, token } = await mkRoom();
  const a = await openStream(id);
  const b = await openStream(id);
  await a.read();
  await b.read();
  assertEquals(rooms.get(id)!.listeners.size, 2);

  assertEquals((await del(`/api/room/${id}`, "wrong")).status, 403);
  assertEquals((await del(`/api/room/${id}`, token)).status, 200);
  assert((await a.read()).includes("event: end"));
  assertEquals((await a.reader.read()).done, true);
  assert((await b.read()).includes("event: end"));
  assertEquals((await b.reader.read()).done, true);
  assertEquals(rooms.has(id), false);
  assertEquals((await del(`/api/room/${id}`, token)).status, 404);
});

Deno.test("keepalive ping touches the room without broadcasting", async () => {
  const { id, token } = await mkRoom();
  const s = await openStream(id);
  await s.read();
  const before = rooms.get(id)!.touched;
  await new Promise((r) => setTimeout(r, 5));
  const res = await post(`/api/room/${id}`, { ping: true }, token);
  assertEquals(res.status, 200);
  assert(rooms.get(id)!.touched > before);
  // the room survives a sweep that would otherwise have ended it
  sweep(rooms.get(id)!.touched + 29 * 60_000);
  assert(rooms.has(id));
  // nothing was sent to the listener: the next thing it sees is the real line
  await post(`/api/room/${id}`, { text: "after ping", final: true }, token);
  assert((await s.read()).includes("after ping"));
  await s.reader.cancel();
  await del(`/api/room/${id}`, token);
});

Deno.test("backlog carries an offset once old lines are trimmed", async () => {
  const { id, token } = await mkRoom();
  for (let i = 1; i <= 405; i++) await post(`/api/room/${id}`, { text: `line ${i}`, final: true }, token);
  const room = rooms.get(id)!;
  assertEquals(room.lines.length, 400);
  assertEquals(room.offset, 5);
  assertEquals(room.lines[0], "line 6");
  const s = await openStream(id);
  const hello = await s.read();
  assert(hello.includes('"offset":5'));
  await s.reader.cancel();
  await del(`/api/room/${id}`, token);
});

Deno.test("pushes reject oversized or malformed bodies", async () => {
  const { id, token } = await mkRoom();
  const big = JSON.stringify({ text: "x".repeat(20_000), final: true });
  assertEquals((await post(`/api/room/${id}`, big, token)).status, 413);
  assertEquals((await post(`/api/room/${id}`, "{not json", token)).status, 400);
  // a long-but-legal final line is trimmed to MAX_CHUNK chars
  await post(`/api/room/${id}`, { text: "y".repeat(3_000), final: true }, token);
  assertEquals(rooms.get(id)!.lines[0].length, 2_000);
  await del(`/api/room/${id}`, token);
});

Deno.test("room creation is capped", async () => {
  const made: { id: string; token: string }[] = [];
  while (rooms.size < 1_000) made.push(await mkRoom());
  assertEquals((await post("/api/room")).status, 503);
  for (const r of made) await del(`/api/room/${r.id}`, r.token);
  assertEquals((await post("/api/room")).status, 200);
  for (const [k, r] of rooms) await del(`/api/room/${k}`, r.token);
});

Deno.test("room creation is rate-limited per client address", async () => {
  const addr = fromAddr("203.0.113.9");
  for (let i = 0; i < 10; i++) {
    assertEquals((await post("/api/room", undefined, undefined, {}, addr)).status, 200);
  }
  const limited = await post("/api/room", undefined, undefined, {}, addr);
  assertEquals(limited.status, 429);
  assert(Number(limited.headers.get("retry-after")) > 0);

  // a different address has its own bucket
  assertEquals((await post("/api/room", undefined, undefined, {}, fromAddr("203.0.113.10"))).status, 200);

  // no resolvable address (the existing test suite's shape): rate limiting is skipped, not denied
  assertEquals((await post("/api/room")).status, 200);

  for (const [k, r] of rooms) await del(`/api/room/${k}`, r.token);
});

Deno.test("LAN address: a real interface wins over localhost whenever one exists", () => {
  const real = Deno.networkInterfaces().some((i) =>
    i.family === "IPv4" && !i.address.startsWith("127.") && !i.address.startsWith("169.254.")
  );
  if (real) assert(lanIp() !== "localhost", "lanIp fell back to localhost despite a usable interface");
});

Deno.test("LAN info only answers to a browser on this machine", async () => {
  const local = await handler(new Request(`${base}/api/info`, { headers: { host: "localhost:8787" } }));
  assertEquals(local.status, 200);
  assert(((await local.json()).lan as string).startsWith("http://"));
  const remote = await handler(new Request(`${base}/api/info`, { headers: { host: "stage.example.com" } }));
  assertEquals(remote.status, 404);
});

Deno.test("pages and the vendored QR encoder are served", async () => {
  for (const p of ["/", "/live/abc123", "/mic/abc123", "/ticker/abc123", "/join", "/demo"]) {
    const r = await handler(new Request(base + p));
    assertEquals(r.status, 200);
    assert(r.headers.get("content-type")!.startsWith("text/html"));
    assert((await r.text()).includes("<!doctype html>"));
  }
  const dgjs = await handler(new Request(`${base}/deepgram.js`));
  assertEquals(dgjs.status, 200);
  assert((await dgjs.text()).includes("StageTypeDeepgram"));
  const js = await handler(new Request(`${base}/vendor/qrcode.js`));
  assertEquals(js.status, 200);
  assert(js.headers.get("content-type")!.startsWith("text/javascript"));
  assert((await js.text()).includes("var qrcode"));
  assertEquals((await handler(new Request(`${base}/ghost.svg`))).headers.get("content-type"), "image/svg+xml");
  const css = await handler(new Request(`${base}/vendor/fonts.css`));
  assertEquals(css.headers.get("content-type"), "text/css; charset=utf-8");
  assert((await css.text()).includes("Atkinson Hyperlegible"));
  const woff = await handler(new Request(`${base}/vendor/fonts/inter-latin-wght-normal.woff2`));
  assertEquals(woff.status, 200);
  assertEquals(woff.headers.get("content-type"), "font/woff2");
  assert(woff.headers.get("cache-control")!.includes("immutable"));
  assertEquals((await handler(new Request(`${base}/vendor/fonts/nope.woff2`))).status, 404);
  assertEquals((await handler(new Request(`${base}/vendor/../server.ts`))).status, 404);
  assertEquals((await handler(new Request(`${base}/live/../server.ts`))).status, 404);
  assertEquals((await handler(new Request(`${base}/nope`))).status, 404);
});

import * as noise from "./signed_noise.ts";

Deno.test("signed noise: verifies its own, rejects tampering, expiry and strangers", async () => {
  const n = await noise.mint("s3cret", 60_000, "d");
  assert(/^d[0-9a-f]{12}$/.test(n.id));
  assertEquals(await noise.verify("s3cret", n.id, n.sig), n.exp);
  assertEquals(await noise.verify("other", n.id, n.sig), null);
  assertEquals(await noise.verify("s3cret", n.id.replace(/.$/, (c) => (c === "0" ? "1" : "0")), n.sig), null);
  assertEquals(await noise.verify("s3cret", n.id, n.sig.slice(0, -1) + (n.sig.endsWith("A") ? "B" : "A")), null);
  assertEquals(await noise.verify("s3cret", n.id, null), null);
  assertEquals(await noise.verify("s3cret", n.id, "garbage"), null);
  assertEquals(await noise.verify("s3cret", n.id, n.sig, n.exp + 1), null);
  assertEquals(await noise.derive("s3cret", n.id, "write"), await noise.derive("s3cret", n.id, "write"));
  assert((await noise.derive("s3cret", n.id, "write")) !== (await noise.derive("s3cret", n.id, "read")));
});

Deno.test("demo rooms: nothing until a signed scan, then small, short and typing-only", async () => {
  const mint = await (await handler(new Request(`${base}/api/demo/mint`))).json();
  assert(!rooms.has(mint.id));
  const status = (s: string) => handler(new Request(`${base}/api/demo/${mint.id}?s=${encodeURIComponent(s)}`));
  assertEquals(await (await status(mint.sig)).json(), { alive: false, listeners: 0 });
  assertEquals((await status("x.aaaaaaaaaaaaaaaaaaaaaa")).status, 404);
  // a made-up or unsigned id never becomes a room
  assertEquals((await handler(new Request(`${base}/api/room/dfeedfacecafe/stream?s=${encodeURIComponent(mint.sig)}`))).status, 404);
  assertEquals((await handler(new Request(`${base}/api/room/${mint.id}/stream`))).status, 404);
  assert(!rooms.has(mint.id));
  // the first signed scan materialises it
  const open = () => handler(new Request(`${base}/api/room/${mint.id}/stream?s=${encodeURIComponent(mint.sig)}`));
  const a = await open();
  const ra = a.body!.getReader();
  assert(new TextDecoder().decode((await ra.read()).value).includes('"title":"StageType demo"'));
  assertEquals(await (await status(mint.sig)).json(), { alive: true, listeners: 1 });
  // the minting page's derived token writes; nothing else does
  assertEquals((await post(`/api/room/${mint.id}`, { text: "hi", final: true, source: "typed" }, "nope")).status, 403);
  assertEquals((await post(`/api/room/${mint.id}`, { text: "hi", final: true, source: "typed" }, mint.token)).status, 200);
  assert(new TextDecoder().decode((await ra.read()).value).includes('"text":"hi"'));
  // three listeners at most
  const b = await open(), c = await open();
  assertEquals((await open()).status, 503);
  // expiry sweeps it
  sweep(mint.exp + 1);
  assert(!rooms.has(mint.id));
  for (const r of [ra, b.body!.getReader(), c.body!.getReader()]) await r.cancel().catch(() => {});
});

Deno.test("assets: an image needs the write token, rides out as a thumb, and comes back whole", async () => {
  const { id, token } = await mkRoom();
  const full = new Uint8Array([...FAKE_WEBP, 1, 2, 3, 4]);
  const thumb = new Uint8Array([...FAKE_WEBP, 9]);
  const form = (type: string, body = full, thumbBody = thumb) => {
    const f = new FormData();
    f.append("full", new File([body], "full.webp", { type }));
    f.append("thumb", new File([thumbBody], "thumb.webp", { type }));
    return f;
  };

  const { reader, read } = await openStream(id);
  await read(); // backlog

  // no token, no image
  assertEquals(
    (await handler(new Request(`${base}/api/room/${id}/asset`, { method: "POST", body: form("image/png", FAKE_PNG, FAKE_PNG) }))).status,
    403,
  );
  // not a real image (spoofed MIME with non-image magic bytes must be refused 415)
  assertEquals(
    (await handler(
      new Request(`${base}/api/room/${id}/asset`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form("image/webp", new Uint8Array([60, 104, 116, 109, 108, 62]), new Uint8Array([1, 2, 3])),
      }),
    )).status,
    415,
  );

  const ok = await handler(
    new Request(`${base}/api/room/${id}/asset`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form("image/webp"),
    }),
  );
  assertEquals(ok.status, 200);
  const saved = await ok.json() as { id: string; thumb: string };
  assert(saved.thumb.startsWith("data:image/webp;base64,"));

  // the room hears about it with the thumb inline, so no phone has to fetch to paint
  const event = await read();
  assert(event.includes("event: asset") && event.includes(saved.id) && event.includes("data:image/webp;base64,"));

  // and the full frame comes back on demand, briefly cached
  const got = await handler(new Request(`${base}/api/room/${id}/asset/${saved.id}`));
  assertEquals(got.status, 200);
  assertEquals(got.headers.get("content-type"), "image/webp");
  assert(got.headers.get("cache-control")?.includes("private"));
  assertEquals(new Uint8Array(await got.arrayBuffer()), full);
  assertEquals((await handler(new Request(`${base}/api/room/${id}/asset/${"0".repeat(24)}`))).status, 404);

  // a late joiner's backlog carries the recent thumbs AND live assetIds
  const late = await openStream(id);
  const lateBacklog = await late.read();
  assert(lateBacklog.includes('"assets":[{"id"') && lateBacklog.includes('"assetIds":["' + saved.id + '"]'));
  await late.reader.cancel();

  // oversize is refused before it lands in memory
  const tooBig = new Uint8Array(2_000_001);
  tooBig.set(FAKE_WEBP);
  assertEquals(
    (await handler(
      new Request(`${base}/api/room/${id}/asset`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form("image/webp", tooBig),
      }),
    )).status,
    413,
  );

  await reader.cancel();
  await del(`/api/room/${id}`, token);
});

Deno.test("assets: the presenter can pull one back", async () => {
  const { id, token } = await mkRoom();
  const form = new FormData();
  form.append("full", new File([FAKE_WEBP], "full.webp", { type: "image/webp" }));
  form.append("thumb", new File([FAKE_WEBP], "thumb.webp", { type: "image/webp" }));
  const saved = await (await handler(
    new Request(`${base}/api/room/${id}/asset`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  )).json() as { id: string };

  const { reader, read } = await openStream(id);
  await read(); // backlog

  assertEquals((await del(`/api/room/${id}/asset/${saved.id}`, "wrong")).status, 403);
  assertEquals((await del(`/api/room/${id}/asset/${saved.id}`, token)).status, 200);
  const gone = await read();
  assert(gone.includes("event: asset-gone") && gone.includes(saved.id));
  assertEquals((await handler(new Request(`${base}/api/room/${id}/asset/${saved.id}`))).status, 404);
  assertEquals((await del(`/api/room/${id}/asset/${saved.id}`, token)).status, 404);
  assertEquals(rooms.get(id)!.assetBytes, 0);

  await reader.cancel();
  await del(`/api/room/${id}`, token);
});

Deno.test("assets: a bad thumb is refused before anything is broadcast or evicted", async () => {
  const { id, token } = await mkRoom();
  const bigThumb = new Uint8Array(70_000); // base64 pushes this past MAX_THUMB_CHARS
  bigThumb.set(FAKE_WEBP);
  const form = new FormData();
  form.append("full", new File([FAKE_WEBP], "f.webp", { type: "image/webp" }));
  form.append("thumb", new File([bigThumb], "t.webp", { type: "image/webp" }));
  const res = await handler(
    new Request(`${base}/api/room/${id}/asset`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  );
  assertEquals(res.status, 413);
  // the room never saw it: no asset, no bytes, no broadcast
  assertEquals(rooms.get(id)!.assets.size, 0);
  assertEquals(rooms.get(id)!.assetBytes, 0);
  await del(`/api/room/${id}`, token);
});

Deno.test("assets: the oldest goes quietly and the room is told", async () => {
  const { id, token } = await mkRoom();
  let firstId = "";
  for (let i = 0; i < 41; i++) {
    const body = new Uint8Array([...FAKE_WEBP, i]);
    const form = new FormData();
    form.append("full", new File([body], "f.webp", { type: "image/webp" }));
    form.append("thumb", new File([body], "t.webp", { type: "image/webp" }));
    const saved = await (await handler(
      new Request(`${base}/api/room/${id}/asset`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
    )).json() as { id: string };
    if (i === 0) firstId = saved.id;
  }
  const room = rooms.get(id)!;
  assertEquals(room.assets.size, 40);
  assertEquals(room.assets.has(firstId), false);
  await del(`/api/room/${id}`, token);
});

Deno.test("assets: the frame is GET only, nosniff, and not cached for an hour", async () => {
  const { id, token } = await mkRoom();
  const form = new FormData();
  form.append("full", new File([FAKE_WEBP], "f.webp", { type: "image/webp" }));
  form.append("thumb", new File([FAKE_WEBP], "t.webp", { type: "image/webp" }));
  const saved = await (await handler(
    new Request(`${base}/api/room/${id}/asset`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
  )).json() as { id: string };

  const got = await handler(new Request(`${base}/api/room/${id}/asset/${saved.id}`));
  assertEquals(got.headers.get("x-content-type-options"), "nosniff");
  assert(got.headers.get("cache-control")?.includes("private"));
  // a POST to the same path must not hand out the picture
  const posted = await handler(new Request(`${base}/api/room/${id}/asset/${saved.id}`, { method: "POST" }));
  assert(posted.status === 404 || posted.status === 405);
  await del(`/api/room/${id}`, token);
});

Deno.test("join codes: lookups on both /api/join and /j/:code are rate limited per address", async () => {
  const addr = fromAddr("203.0.113.9");
  let limited = 0;
  for (let i = 0; i < 310; i++) {
    const res = await handler(new Request(`${base}/api/join/ABCD`), addr);
    if (res.status === 429) limited++;
  }
  assert(limited > 0, "the 310th lookup from one address should be refused");
  // /j/:code shares the same door and cannot bypass the rate limit
  assertEquals((await handler(new Request(`${base}/j/ABCD`), addr)).status, 429);
});

Deno.test("sweep clears expired rate-limit buckets", async () => {
  const addr = fromAddr("198.51.100.7");
  let last = 0;
  for (let i = 0; i < 310; i++) last = (await handler(new Request(`${base}/api/join/ZZZZ`), addr)).status;
  assertEquals(last, 429);
  // a window later the address is welcome again, and the stored bucket went with the sweep
  sweep(Date.now() + 2 * 60_000);
  assertEquals((await handler(new Request(`${base}/api/join/ZZZZ`), addr)).status, 404);
});

Deno.test("deepgram: names are sanitised into keyterms", () => {
  const url = new URL(`${base}/?keyterm=Pibulus&keyterm=SoftStack%20Radio&keyterm=${"x".repeat(80)}&keyterm=Pibulus&keyterm=%3Cscript%3E`);
  assertEquals(keytermsFrom(url), ["Pibulus", "SoftStack Radio", "x".repeat(40), "script"]);
  assertEquals(keytermsFrom(new URL(base)), []);
});

Deno.test("speaker tags: sanitised, broadcast with finals, and carried in backlog", async () => {
  assertEquals(cleanSpeaker("  Host <script> "), "Host script");
  assertEquals(cleanSpeaker("x".repeat(40)), "x".repeat(24));
  const { id, token } = await mkRoom();
  const { reader, read } = await openStream(id);
  await read(); // initial backlog

  await post(`/api/room/${id}`, { text: "Welcome to the salon.", final: true, source: "mic", speaker: "Host" }, token);
  const ev = await read();
  assert(ev.includes("event: final") && ev.includes('"speaker":"Host"'));

  const late = await openStream(id);
  const backlog = await late.read();
  assert(backlog.includes('"speakers":["Host"]'));

  await late.reader.cancel();
  await reader.cancel();
  await del(`/api/room/${id}`, token);
});

Deno.test("listen-local helper: parses mic URL, strips whisper markers, and posts to room", async () => {
  const { id, token } = await mkRoom();
  const target = parseMicTarget(`${base}/mic/${id}?lang=en-AU#${token}`, "Moderator");
  assertEquals(target, { origin: base, roomId: id, token, speaker: "Moderator" });
  assertEquals(
    cleanTranscriptLine("\x1b[2K[00:00.000 --> 00:03.200]   Every room has a back row. [BLANK_AUDIO] "),
    "Every room has a back row.",
  );
  assertEquals(cleanTranscriptLine("[BLANK_AUDIO] [MUSIC]"), "");

  const ok = await postLocalLine(
    target,
    "[00:01.000 --> 00:04.000] Local whisper line.",
    true,
    (req, init) => handler(new Request(req, init)),
  );
  assertEquals(ok, true);
  assertEquals(rooms.get(id)!.lines, ["Local whisper line."]);
  assertEquals(rooms.get(id)!.speakers, ["Moderator"]);
  assertThrows(() => parseMicTarget(`${base}/mic/../../admin#${token}`));
  assertThrows(() => parseMicTarget(`${base}/mic/#${token}`));
  assertEquals(parseMicTarget(`${base}/mic/${id}#token=${token}&pass=club%20secret`).token, token);
  assert(sameToken("Bearer abc", "Bearer abc"));
  assert(!sameToken("Bearer abc", "Bearer ab"));
  await del(`/api/room/${id}`, token);
});

Deno.test("multi-phone tracking: room stays phone-live until the last paired phone pauses or drops", async () => {
  const { id, token } = await mkRoom();
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: true, phone: "hostA" }, token);
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: true, phone: "guestB" }, token);
  assertEquals(rooms.get(id)!.phones.size, 2);
  assertEquals(rooms.get(id)!.phone.live, true);

  // hostA pauses, but guestB is still live -> room phone state remains live
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: false, phone: "hostA" }, token);
  assertEquals(rooms.get(id)!.phones.size, 1);
  assertEquals(rooms.get(id)!.phone.live, true);

  // guestB pauses -> last phone gone, room phone state becomes false
  await post(`/api/room/${id}`, { ping: true, source: "phone", live: false, phone: "guestB" }, token);
  assertEquals(rooms.get(id)!.phones.size, 0);
  assertEquals(rooms.get(id)!.phone.live, false);
  await del(`/api/room/${id}`, token);
});

Deno.test("security & ops: headers, healthz, version, HEAD 404, cross-site guard, pinned links, paused broadcast", async () => {
  const home = await handler(new Request(`${base}/`));
  assertEquals(home.headers.get("x-frame-options"), "DENY");
  assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  const ticker = await handler(new Request(`${base}/ticker/abc123`));
  assertEquals(ticker.headers.get("x-frame-options"), null);
  assert(ticker.headers.get("content-security-policy")?.includes("frame-ancestors *"));
  assertEquals((await handler(new Request(`${base}/vendor/fonts/nope.woff2`, { method: "HEAD" }))).status, 404);
  assertEquals((await handler(new Request(`${base}/healthz`))).status, 200);
  assertEquals((await handler(new Request(`${base}/healthz`))).headers.get("x-robots-tag"), "noindex, nofollow");
  const verRes = await handler(new Request(`${base}/version.json`));
  assertEquals(verRes.status, 200);
  assertEquals(verRes.headers.get("x-robots-tag"), "noindex, nofollow");
  const robotsTxt = await (await handler(new Request(`${base}/robots.txt`))).text();
  assert(robotsTxt.includes("Disallow: /j/") && robotsTxt.includes("Disallow: /live$") && robotsTxt.includes("Disallow: /healthz"));
  const sitemapXml = await (await handler(new Request(`${base}/sitemap.xml`))).text();
  assert(sitemapXml.includes("<lastmod>") && sitemapXml.includes("/demo") && sitemapXml.includes("/join"));
  assertEquals((await handler(new Request(`${base}/shared.js`))).status, 200);
  const manifestHead = await handler(new Request(`${base}/manifest.webmanifest`, { method: "HEAD" }));
  assertEquals(manifestHead.status, 200);
  assert(Number(manifestHead.headers.get("content-length")) > 0, "HEAD /manifest.webmanifest must carry Content-Length");
  const swRes = await handler(new Request(`${base}/sw.js`));
  assertEquals(swRes.status, 200);
  assertEquals(swRes.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
  assertEquals(swRes.headers.get("cdn-cache-control"), "no-store");
  const appleIcon = await handler(new Request(`${base}/apple-touch-icon.png`));
  assertEquals(appleIcon.status, 200);
  assert(!appleIcon.headers.get("cache-control")?.includes("immutable"));
  assertEquals((await handler(new Request(`${base}/icon-192.png`))).status, 200);
  assertEquals((await handler(new Request(`${base}/icon-512.png`))).status, 200);
  assertEquals((await handler(new Request(`${base}/og-image.png`))).status, 200);
  // Referrer-Policy split + X-Robots-Tag on capability routes and error states
  assertEquals(home.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assertEquals(home.headers.get("x-robots-tag"), null);
  const livePage = await handler(new Request(`${base}/live/abc123`));
  assertEquals(livePage.headers.get("referrer-policy"), "no-referrer");
  assertEquals(livePage.headers.get("x-robots-tag"), "noindex, nofollow");
  const joinNope = await handler(new Request(`${base}/join?nope=ZZZZ`));
  assertEquals(joinNope.headers.get("x-robots-tag"), "noindex, nofollow");
  const joinClean = await handler(new Request(`${base}/join`));
  assertEquals(joinClean.headers.get("x-robots-tag"), null);
  assertEquals(joinClean.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  // Plain HTTP -> HTTPS 301 behind TRUST_PROXY (while localhost and /healthz stay reachable)
  Deno.env.set("TRUST_PROXY", "cloudflare");
  try {
    const httpRedir = await handler(new Request("http://stage.talktype.app/demo?x=1", { headers: { "x-forwarded-proto": "http" } }));
    assertEquals(httpRedir.status, 301);
    assertEquals(httpRedir.headers.get("location"), "https://stage.talktype.app/demo?x=1");
    assertEquals((await handler(new Request("http://stage.talktype.app/healthz"))).status, 200);
    assertEquals((await handler(new Request("http://127.0.0.1:9027/version.json"))).status, 200);
    const httpsRobots =
      await (await handler(new Request("http://stage.talktype.app/robots.txt", { headers: { "x-forwarded-proto": "https" } }))).text();
    assert(httpsRobots.includes("Sitemap: https://stage.talktype.app/sitemap.xml"));
  } finally {
    Deno.env.delete("TRUST_PROXY");
  }
  assertEquals((await post("/api/room", {}, undefined, { "sec-fetch-site": "cross-site" })).status, 403);
  assertEquals(sniffImageType(FAKE_WEBP), "image/webp");
  assertEquals(sniffImageType(FAKE_PNG), "image/png");
  assertEquals(sniffImageType(new Uint8Array([1, 2, 3])), null);
  assertEquals(
    cleanLinks([
      "madebypablo.app",
      "slides",
      "144.963",
      "https://144.963",
      "https://maps.google.com/@-37.767,144.963,15z",
      "http://localhost:8787/demo",
      "javascript:alert(1)",
      "https://stagetype.app",
    ]),
    [
      "https://madebypablo.app/",
      "https://maps.google.com/@-37.767,144.963,15z",
      "http://localhost:8787/demo",
      "https://stagetype.app/",
    ],
  );

  const created = await (await post("/api/room", { title: "Links talk", lang: "ar-SA", links: ["madebypablo.app"] })).json();
  const s = await openStream(created.id);
  const first = await s.read();
  assert(first.includes('"lang":"ar-SA"') && first.includes('"links":["https://madebypablo.app/"]'));
  await post(`/api/room/${created.id}`, { paused: true }, created.token);
  assert((await s.read()).includes('event: paused\ndata: {"paused":true}'));
  await post(`/api/room/${created.id}`, { links: ["https://stagetype.app"] }, created.token);
  assert((await s.read()).includes('event: links\ndata: {"links":["https://stagetype.app/"]}'));
  await s.reader.cancel();
  await del(`/api/room/${created.id}`, created.token);
});

Deno.test({
  name: "deepgram phone pause: closing a Deepgram phone socket does not resurrect phone.live",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dg = mockDeepgram(0);
    Deno.env.set("DEEPGRAM_URL", `ws://localhost:${dg.addr.port}/listen`);
    Deno.env.set("DEEPGRAM_API_KEY", "test-key");
    const relay = Deno.serve({ port: 0, onListen() {} }, handler);
    const origin = `ws://localhost:${relay.addr.port}`;
    const { id, token } = await mkRoom();

    await post(`/api/room/${id}`, { ping: true, source: "phone", live: true, phone: "ph-1" }, token);
    const ws = new WebSocket(`${origin}/api/room/${id}/audio?source=phone&lang=en-AU&phone=ph-1`, ["bearer", token]);
    await new Promise<void>((r) => {
      ws.onopen = () => r();
    });
    ws.send(JSON.stringify({ type: "stop" }));
    await new Promise<void>((r) => {
      ws.onclose = () => r();
    });
    // Now pause the phone: room.phone.live must become and STAY false
    await post(`/api/room/${id}`, { ping: true, source: "phone", live: false, phone: "ph-1" }, token);
    assertEquals(rooms.get(id)!.phone.live, false);
    assertEquals(rooms.get(id)!.phones.size, 0);

    await del(`/api/room/${id}`, token);
    Deno.env.delete("DEEPGRAM_API_KEY");
    Deno.env.delete("DEEPGRAM_URL");
    await relay.shutdown();
    await dg.shutdown();
  },
});

Deno.test({
  name: "deepgram pass gate: STAGETYPE_DEEPGRAM_PASS blocks ungated upgrades and accepts pass-b64 with special chars",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dg = mockDeepgram(0);
    Deno.env.set("DEEPGRAM_URL", `ws://localhost:${dg.addr.port}/listen`);
    Deno.env.set("DEEPGRAM_API_KEY", "test-key");
    Deno.env.set("STAGETYPE_DEEPGRAM_PASS", "club: secret pass!");
    const relay = Deno.serve({ port: 0, onListen() {} }, handler);
    const origin = `ws://localhost:${relay.addr.port}`;

    const eng = await (await handler(new Request(`${base}/api/engines`))).json();
    assertEquals(eng, { browser: true, deepgram: true, passRequired: true });
    const { id, token } = await mkRoom();
    const denied = await handler(
      new Request(`${base}/api/room/${id}/audio?source=mic`, {
        headers: { upgrade: "websocket", "sec-websocket-protocol": `bearer, ${token}` },
      }),
    );
    assertEquals(denied.status, 403);

    const b64 = btoa("club: secret pass!").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const ws = new WebSocket(`${origin}/api/room/${id}/audio?source=mic&lang=en-AU`, ["bearer", token, "pass-b64", b64]);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("pass-b64 upgrade failed"));
    });
    ws.send(JSON.stringify({ type: "stop" }));
    await new Promise<void>((r) => {
      ws.onclose = () => r();
    });

    await del(`/api/room/${id}`, token);
    Deno.env.delete("STAGETYPE_DEEPGRAM_PASS");
    Deno.env.delete("DEEPGRAM_API_KEY");
    Deno.env.delete("DEEPGRAM_URL");
    await relay.shutdown();
    await dg.shutdown();
  },
});

Deno.test("lobby pass: mint allocates zero rooms until first scan or Start captions, then keeps code & broadcasts meta", async () => {
  const beforeRooms = rooms.size;
  const minted = await (await handler(new Request(`${base}/api/lobby/mint`))).json() as {
    id: string;
    code: string;
    token: string;
  };
  assert(/^[a-z0-9]{32}$/.test(minted.id) && /^[A-Z]{4}$/.test(minted.code) && minted.token.length === 32);
  assertEquals(rooms.size, beforeRooms); // zero Room allocated at t=0

  // Early-bird phone resolves the 4-letter lobby code before Start captions
  const redir = await handler(new Request(`${base}/j/${minted.code}`));
  assertEquals(redir.status, 302);
  assertEquals(redir.headers.get("location"), `/live/${minted.id}`);
  assertEquals(rooms.size, beforeRooms); // redirect alone still hasn't allocated a Room

  // Phone opens SSE stream -> materialises the Room on demand
  const s = await openStream(minted.id);
  assert((await s.read()).includes("event: backlog"));
  assertEquals(rooms.size, beforeRooms + 1);
  const statusRes = await (await handler(new Request(`${base}/api/lobby/${minted.id}`))).json();
  assertEquals(statusRes.materialized, true);
  assertEquals(statusRes.listeners, 1);

  // Presenter clicks Start captions -> claims the exact same id/code and broadcasts meta to waiting phone
  const claimed = await (await post("/api/room", {
    title: "Early Bird Keynote",
    lang: "en-AU",
    links: ["https://madebypablo.app"],
    lobbyId: minted.id,
    lobbyToken: minted.token,
  })).json();
  assertEquals(claimed.id, minted.id);
  assertEquals(claimed.code, minted.code);
  assertEquals(claimed.token, minted.token);
  const metaEvt = await s.read();
  assert(metaEvt.includes("event: meta") && metaEvt.includes("Early Bird Keynote"));

  await s.reader.cancel();
  await del(`/api/room/${minted.id}`, minted.token);
});

Deno.test({
  name: "event passes: Square checkout -> signed webhook -> claim poll -> first-use clock activation, expiry & dg: BYOK",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { resetMemoryStoreForTests, validateAndActivatePass } = await import("./passes.ts");
    resetMemoryStoreForTests();

    const dg = mockDeepgram(0);
    const sqOrders = new Map<string, string>();
    const sqServer = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
      const u = new URL(req.url);
      if (req.method === "POST" && u.pathname === "/v2/online-checkout/payment-links") {
        const body = await req.json();
        const orderId = `ord_${crypto.randomUUID().slice(0, 8)}`;
        sqOrders.set(orderId, "OPEN");
        return Response.json({
          payment_link: {
            id: "pl_test_1",
            order_id: orderId,
            url: `https://checkout.square.site/pay/${orderId}`,
            description: body.description,
          },
        });
      }
      const ordMatch = u.pathname.match(/^\/v2\/orders\/(.+)$/);
      if (req.method === "GET" && ordMatch) {
        return Response.json({ order: { id: ordMatch[1], state: sqOrders.get(ordMatch[1]) ?? "OPEN" } });
      }
      return new Response("not found", { status: 404 });
    });

    const sigKey = "sq_wh_secret_test_key_123456";
    const notifUrl = "https://stage.talktype.app/api/square/webhook";
    Deno.env.set("DEEPGRAM_API_KEY", "dg-relay-test-key");
    Deno.env.set("DEEPGRAM_URL", `ws://localhost:${dg.addr.port}/listen`);
    Deno.env.set("STAGETYPE_PASS_SECRET", "stagetype-super-secret-pass-hmac-key-2026");
    Deno.env.set("SQUARE_BASE_URL", `http://127.0.0.1:${sqServer.addr.port}`);
    Deno.env.set("SQUARE_ACCESS_TOKEN", "sq_test_access_token_12345");
    Deno.env.set("SQUARE_LOCATION_ID", "LS821EYMQCANH");
    Deno.env.set("SQUARE_WEBHOOK_SIGNATURE_KEY", sigKey);
    Deno.env.set("SQUARE_WEBHOOK_NOTIFICATION_URL", notifUrl);

    const relay = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, handler);
    const origin = `ws://localhost:${relay.addr.port}`;

    try {
      const eng = await (await handler(new Request(`${base}/api/engines`))).json();
      assertEquals(eng, { browser: true, deepgram: true, passRequired: true, passesAvailable: true });

      const tiersRes = await (await handler(new Request(`${base}/api/passes`))).json();
      assertEquals(tiersRes.available, true);
      assertEquals(tiersRes.tiers.length, 3);

      // 1. Create Meetup Pass checkout (A$15 / 3h)
      const coRes = await post("/api/passes/checkout", { tier: "meetup" });
      assertEquals(coRes.status, 200);
      const co = await coRes.json() as { checkoutId: string; claimToken: string; checkoutUrl: string };
      assert(co.checkoutUrl.startsWith("https://checkout.square.site/pay/ord_"));
      const orderId = co.checkoutUrl.split("/").pop()!;

      // Pending before payment
      const pollPending = await (await handler(
        new Request(`${base}/api/passes/checkout/${co.checkoutId}`, {
          headers: { "x-stagetype-claim": co.claimToken },
        }),
      )).json();
      assertEquals(pollPending.status, "pending");

      // Wrong claim token rejected
      const badClaim = await handler(
        new Request(`${base}/api/passes/checkout/${co.checkoutId}`, {
          headers: { "x-stagetype-claim": "wrong-token" },
        }),
      );
      assertEquals(badClaim.status, 403);

      // Bad webhook signature rejected
      const webhookPayload = JSON.stringify({
        type: "payment.updated",
        data: { object: { payment: { status: "COMPLETED", order_id: orderId } } },
      });
      const badWh = await handler(
        new Request(`${base}/api/square/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-square-hmacsha256-signature": "forged" },
          body: webhookPayload,
        }),
      );
      assertEquals(badWh.status, 401);

      // Valid Square HMAC-SHA256 webhook mints deterministic ST-XXXX-XXXX pass
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(sigKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(notifUrl + webhookPayload)));
      const sig = btoa(String.fromCharCode(...mac));
      const goodWh = await handler(
        new Request(`${base}/api/square/webhook`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-square-hmacsha256-signature": sig },
          body: webhookPayload,
        }),
      );
      assertEquals(goodWh.status, 200);

      // Poll now returns paid ST-XXXX-XXXX code
      const pollPaid = await (await handler(
        new Request(`${base}/api/passes/checkout/${co.checkoutId}`, {
          headers: { "x-stagetype-claim": co.claimToken },
        }),
      )).json() as { status: string; code: string; hours: number };
      assertEquals(pollPaid.status, "paid");
      assertEquals(pollPaid.hours, 3);
      assert(/^ST-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pollPaid.code));

      // Read-only check shows valid & NOT yet activated (clock hasn't started!)
      const preCheck = await (await handler(new Request(`${base}/api/passes/check?code=${pollPaid.code}`))).json();
      assertEquals(preCheck.valid, true);
      assertEquals(preCheck.activated, false);

      // Connecting to Deepgram audio WS activates the pass & starts the 3h clock
      const { id, token } = await mkRoom();
      const b64 = btoa(pollPaid.code.toLowerCase()).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const ws = new WebSocket(`${origin}/api/room/${id}/audio?source=mic&lang=en-AU`, ["bearer", token, "pass-b64", b64]);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("event pass WS upgrade failed"));
      });
      ws.send(JSON.stringify({ type: "stop" }));
      await new Promise<void>((r) => {
        ws.onclose = () => r();
      });

      const postCheck = await (await handler(new Request(`${base}/api/passes/check?code=${pollPaid.code}`))).json();
      assertEquals(postCheck.valid, true);
      assertEquals(postCheck.activated, true);

      // Fast-forward past 3h -> pass is rejected as expired
      const afterExpiry = await validateAndActivatePass(pollPaid.code, Date.now() + 4 * 3600_000);
      assertEquals(afterExpiry, { ok: false, reason: "expired" });

      // BYO Deepgram escape hatch (`dg:...`) works even without a relay pass
      const byoB64 = btoa("dg:custom_speaker_deepgram_key_12345").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const wsByo = new WebSocket(`${origin}/api/room/${id}/audio?source=mic&lang=en-AU`, ["bearer", token, "pass-b64", byoB64]);
      await new Promise<void>((resolve, reject) => {
        wsByo.onopen = () => resolve();
        wsByo.onerror = () => reject(new Error("dg: BYO WS upgrade failed"));
      });
      wsByo.send(JSON.stringify({ type: "stop" }));
      await new Promise<void>((r) => {
        wsByo.onclose = () => r();
      });

      await del(`/api/room/${id}`, token);
    } finally {
      for (
        const k of [
          "DEEPGRAM_API_KEY",
          "DEEPGRAM_URL",
          "STAGETYPE_PASS_SECRET",
          "SQUARE_BASE_URL",
          "SQUARE_ACCESS_TOKEN",
          "SQUARE_LOCATION_ID",
          "SQUARE_WEBHOOK_SIGNATURE_KEY",
          "SQUARE_WEBHOOK_NOTIFICATION_URL",
        ]
      ) Deno.env.delete(k);
      resetMemoryStoreForTests();
      await relay.shutdown();
      await sqServer.shutdown();
      await dg.shutdown();
    }
  },
});

Deno.test({
  name:
    "cloud turbo (/api/room/:id/transcribe): validates WAV, passes prompt glossary to Groq Whisper-v3-Turbo, strips hallucinations, and broadcasts final",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let lastPrompt = "";
    let nextTranscript = "Welcome to Brunswick tonight.";
    const groqMock = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
      const form = await req.formData();
      lastPrompt = String(form.get("prompt") ?? "");
      return Response.json({ text: nextTranscript });
    });

    Deno.env.set("GROQ_API_KEY", "gsk_test_relay_key_1234567890");
    Deno.env.set("GROQ_API_URL", `http://127.0.0.1:${groqMock.addr.port}/v1/audio/transcriptions`);
    Deno.env.set("STAGETYPE_DEEPGRAM_PASS", "turbo-pass");

    try {
      const eng = await (await handler(new Request(`${base}/api/engines`))).json();
      assertEquals(eng, { browser: true, deepgram: false, turbo: true, passRequired: true });

      const { id, token } = await mkRoom();
      const s = await openStream(id);
      await s.read(); // backlog

      // Build minimal valid 48-byte RIFF WAVE
      const wav = new Uint8Array(48);
      wav.set(new TextEncoder().encode("RIFF"), 0);
      wav.set(new TextEncoder().encode("WAVEfmt "), 8);
      wav.set(new TextEncoder().encode("data"), 36);

      // Missing pass -> 403
      const denied = await handler(
        new Request(`${base}/api/room/${id}/transcribe?source=mic&lang=en-AU&keyterm=Slide-o-Matic`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "audio/wav" },
          body: wav,
        }),
      );
      assertEquals(denied.status, 403);

      // Valid pass -> forwards WAV + glossary prompt to Groq and broadcasts settled line to SSE listeners
      const passB64 = btoa("turbo-pass").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const okRes = await handler(
        new Request(`${base}/api/room/${id}/transcribe?source=mic&lang=en-AU&keyterm=Slide-o-Matic&keyterm=StageType`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "audio/wav",
            "x-stagetype-pass": passB64,
          },
          body: wav,
        }),
      );
      assertEquals(okRes.status, 200);
      assertEquals((await okRes.json()).text, "Welcome to Brunswick tonight.");
      assertEquals(lastPrompt, "Slide-o-Matic, StageType");
      const evt = await s.read();
      assert(evt.includes("event: final") && evt.includes("Welcome to Brunswick tonight."));

      // Classic Whisper silence hallucination ("Thank you for watching.") is stripped cleanly
      nextTranscript = "Thank you for watching.";
      const hallRes = await handler(
        new Request(`${base}/api/room/${id}/transcribe?source=mic&lang=en-AU`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "audio/wav",
            "x-stagetype-pass": passB64,
          },
          body: wav,
        }),
      );
      assertEquals(hallRes.status, 200);
      assertEquals((await hallRes.json()).text, "");

      // Static worker script is served cleanly
      const workerRes = await handler(new Request(`${base}/stt_worker.js`));
      assertEquals(workerRes.status, 200);

      await s.reader.cancel();
      await del(`/api/room/${id}`, token);
    } finally {
      Deno.env.delete("GROQ_API_KEY");
      Deno.env.delete("GROQ_API_URL");
      Deno.env.delete("STAGETYPE_DEEPGRAM_PASS");
      await groqMock.shutdown();
    }
  },
});
