import { handler, rooms, sweep } from "./server.ts";
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
  for (const p of ["/", "/live/abc123", "/mic/abc123"]) {
    const r = await handler(new Request(base + p));
    assertEquals(r.status, 200);
    assert(r.headers.get("content-type")!.startsWith("text/html"));
    assert((await r.text()).includes("<!doctype html>"));
  }
  const js = await handler(new Request(`${base}/vendor/qrcode.js`));
  assertEquals(js.status, 200);
  assert(js.headers.get("content-type")!.startsWith("text/javascript"));
  assert((await js.text()).includes("var qrcode"));
  assertEquals((await handler(new Request(`${base}/ghost.svg`))).headers.get("content-type"), "image/svg+xml");
  assertEquals((await handler(new Request(`${base}/live/../server.ts`))).status, 404);
  assertEquals((await handler(new Request(`${base}/nope`))).status, 404);
});
