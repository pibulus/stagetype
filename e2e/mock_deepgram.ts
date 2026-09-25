// A stand-in for Deepgram's streaming endpoint: same subprotocol auth ("token", key), same message
// shapes. After the 3rd audio chunk: an interim. 6th: a speech_final line. 12th: an is_final segment
// closed by UtteranceEnd, the other way an utterance ends.
export function mockDeepgram(port = 8790, key = "test-key") {
  return Deno.serve({ port, hostname: "127.0.0.1", onListen() {} }, (req) => {
    if (req.headers.get("upgrade") !== "websocket") return new Response("mock deepgram");
    if ((req.headers.get("sec-websocket-protocol") ?? "").split(",")[1]?.trim() !== key) return new Response("bad key", { status: 401 });
    const { socket, response } = Deno.upgradeWebSocket(req, { protocol: "token" });
    const results = (transcript: string, is_final: boolean, speech_final: boolean) =>
      socket.send(JSON.stringify({ type: "Results", is_final, speech_final, channel: { alternatives: [{ transcript }] } }));
    let chunks = 0;
    socket.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          if (JSON.parse(e.data).type === "CloseStream") socket.close();
        } catch { /* not json */ }
        return;
      }
      chunks++;
      if (chunks === 3) results("Hello from", false, false);
      if (chunks === 6) results("Hello from the relay.", true, true);
      if (chunks === 12) {
        results("Second line", true, false);
        socket.send(JSON.stringify({ type: "UtteranceEnd" }));
      }
    };
    return response;
  });
}

if (import.meta.main) mockDeepgram();
