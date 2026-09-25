import { checkPhones, handler, newCode, rooms, sweep } from "./server.ts";

// A stand-in for Deepgram's streaming endpoint: same subprotocol auth, same message shapes.
// First audio chunk gets an interim then a speech_final result; the eighth gets an is_final segment
// followed by an UtteranceEnd, which is the other way an utterance closes.
function mockDeepgram() {
  const seen: string[] = [];
  const srv = Deno.serve({ port: 0, onListen() {} }, (req) => {
    if (req.headers.get("upgrade") !== "websocket") return new Response("mock");
    const key = (req.headers.get("sec-websocket-protocol") ?? "").split(",")[1]?.trim();
    if (key !== "test-key") return new Response("bad key", { status: 401 });
    const { socket, response } = Deno.upgradeWebSocket(req, { protocol: "token" });
    const results = (transcript: string, is_final: boolean, speech_final: boolean) =>
      socket.send(JSON.stringify({ type: "Results", is_final, speech_final, channel: { alternatives: [{ transcript }] } }));
    let chunks = 0;
    socket.onmessage = (e) => {
      if (typeof e.data === "string") { const m = JSON.parse(e.data); seen.push(m.type); if (m.type === "CloseStream") socket.close(); return; }
      chunks++;
      if (chunks === 1) { results("Hello from", false, false); results("Hello from the relay.", true, true); }
      if (chunks === 8) { results("Second", false, false); results("Second line", true, false); socket.send(JSON.stringify({ type: "UtteranceEnd" })); }
    };
    return response;
  });
  return { url: `ws://localhost:${srv.addr.port}/listen`, seen, close: () => srv.shutdown() };
}
import { assert, assertEquals } from "jsr:@std/assert@1";

const base = "http://x";
const post = (path: string, body?: unknown, token?: string, extraHeaders: Record<string, string> = {}) =>
  handler(new Request(base + path, {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  }));
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
  assertEquals(new URL(redir.headers.get("location")!).pathname, `/live/${r.id}`);
  await del(`/api/room/${r.id}`, r.token);
  assertEquals((await handler(new Request(`${base}/api/join/${r.code}`))).status, 404);
  const gone = await handler(new Request(`${base}/j/${r.code}`));
  assertEquals(gone.status, 302);
  assert(gone.headers.get("location")!.endsWith(`/join?nope=${r.code}`));
  assertEquals((await handler(new Request(`${base}/join`))).status, 200);
  assertEquals((await handler(new Request(`${base}/live`))).status, 200);
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
  await s.reader.cancel(); await s2.reader.cancel();
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
  sanitizeOps: false, sanitizeResources: false, // real sockets on both sides; everything is closed below
  async fn() {
    const dg = mockDeepgram();
    Deno.env.set("DEEPGRAM_URL", dg.url);
    Deno.env.set("DEEPGRAM_API_KEY", "test-key");
    const relay = Deno.serve({ port: 0, onListen() {} }, handler);
    const origin = `ws://localhost:${relay.addr.port}`;
    const { id, token } = await mkRoom();
    const s = await openStream(id);
    await s.read();
    let sse = "";
    const until = async (needle: string) => { while (!sse.includes(needle)) sse += await s.read(); };

    // wrong token: the handshake is refused
    const bad = new WebSocket(`${origin}/api/room/${id}/audio`, ["bearer", "nope"]);
    await new Promise<void>((r) => { bad.onclose = () => r(); bad.onerror = () => {}; });

    const ws = new WebSocket(`${origin}/api/room/${id}/audio?source=mic&lang=en-AU`, ["bearer", token]);
    ws.binaryType = "arraybuffer";
    const got: string[] = [];
    ws.onmessage = (e) => got.push(String(e.data));
    await new Promise<void>((r) => { ws.onopen = () => r(); });
    while (!got.some((g) => g.includes("ready"))) await new Promise((r) => setTimeout(r, 10));
    const chunk = new Int16Array(1600).buffer;
    ws.send(chunk);
    await until('"text":"Hello from the relay."');
    assert(sse.includes('event: interim\ndata: {"text":"Hello from","source":"mic"}'));
    assert(sse.includes('event: final\ndata: {"text":"Hello from the relay.","seq":1,"source":"mic"}'));
    assertEquals(rooms.get(id)!.lines, ["Hello from the relay."]);
    for (let i = 0; i < 7; i++) ws.send(chunk);
    await until('"text":"Second line","seq":2');
    assert(sse.includes('event: interim\ndata: {"text":"Second","source":"mic"}'));
    assert(sse.includes('event: interim\ndata: {"text":"Second line","source":"mic"}'), "finalised-but-open segment shows as interim");
    assertEquals(rooms.get(id)!.lines, ["Hello from the relay.", "Second line"]);
    while (!got.some((g) => g.includes('"final":"Second line"'))) await new Promise((r) => setTimeout(r, 10)); // its own socket, its own timing

    ws.send(JSON.stringify({ type: "stop" }));
    await new Promise<void>((r) => { ws.onclose = () => r(); });
    await new Promise((r) => setTimeout(r, 50));
    assert(dg.seen.includes("CloseStream"), "upstream told to close: " + dg.seen.join(","));

    await s.reader.cancel();
    await del(`/api/room/${id}`, token);
    Deno.env.delete("DEEPGRAM_API_KEY"); Deno.env.delete("DEEPGRAM_URL");
    await relay.shutdown();
    await dg.close();
  },
});

Deno.test("ending a talk closes every listener and clears its keepalive timer", async () => {
  const { id, token } = await mkRoom();
  const a = await openStream(id);
  const b = await openStream(id);
  await a.read(); await b.read();
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
  const a = await open(); const ra = a.body!.getReader();
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
