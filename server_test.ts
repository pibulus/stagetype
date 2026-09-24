import { handler, rooms, sweep } from "./server.ts";
import { assert, assertEquals } from "jsr:@std/assert@1";

const base = "http://x";
const post = (path: string, body?: unknown, token?: string) =>
  handler(new Request(base + path, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body ? JSON.stringify(body) : undefined,
  }));

Deno.test("room lifecycle: create, auth, backlog, stream, end, ttl", async () => {
  const { id, token } = await (await post("/api/room")).json();

  assertEquals((await post(`/api/room/${id}`, { text: "hi", final: true }, "wrong")).status, 403);
  assertEquals((await post(`/api/room/${id}`, { text: "hello world", final: true }, token)).status, 200);
  await post(`/api/room/${id}`, { text: "typing…", final: false }, token); // interim, not kept
  assertEquals(rooms.get(id)!.lines, ["hello world"]);

  // late joiner gets the backlog first
  const res = await handler(new Request(`${base}/api/room/${id}/stream`));
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert(first.includes("event: backlog") && first.includes("hello world"));

  // live chunk reaches the listener
  await post(`/api/room/${id}`, { text: "second line", final: true }, token);
  const next = new TextDecoder().decode((await reader.read()).value);
  assert(next.includes("event: final") && next.includes("second line"));
  await reader.cancel();

  // idle rooms get swept
  sweep(Date.now() + 31 * 60_000);
  assertEquals(rooms.has(id), false);
  assertEquals((await handler(new Request(`${base}/api/room/${id}/stream`))).status, 404);
});
