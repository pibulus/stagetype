// StageType relay-side speech. The page captures the mic as 16 kHz PCM in an AudioWorklet and streams
// it to the relay over a WebSocket; the relay forwards to Deepgram and turns results into room pushes.
// Used by the console (source "mic") and the phone (source "phone"). Nothing here talks to Deepgram.
(() => {
  const WORKLET = `
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor(o) { super(); this.target = (o.processorOptions && o.processorOptions.targetRate) || 16000; this.buf = []; this.acc = 0; this.n = 0; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ratio = sampleRate / this.target;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.pos += 1;
      if (this.pos >= ratio) { this.pos -= ratio; this.buf.push(this.acc / this.n); this.acc = 0; this.n = 0; }
    }
    if (this.buf.length >= 1600) { // 100 ms
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < out.length; i++) { const s = Math.max(-1, Math.min(1, this.buf[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.port.postMessage({ pcm: out.buffer }, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor("pcm16-downsampler", Pcm16Downsampler);`;

  async function start({ roomId, token, source = "mic", lang = "en", keyterms = [], speaker = "", phoneId = "", pass = "", onInterim, onFinal, onError, onReady }) {
    if (!window.AudioWorkletNode || !window.WebSocket) throw new Error("this browser can't stream audio");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let ctx = null, srcNode = null, node = null, mute = null;
    const teardown = () => {
      try { if (node) { node.port.onmessage = null; node.disconnect(); } srcNode?.disconnect(); mute?.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close?.().catch(() => {});
    };
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      const modUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      try { await ctx.audioWorklet.addModule(modUrl); } finally { URL.revokeObjectURL(modUrl); }
      srcNode = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, "pcm16-downsampler", { processorOptions: { targetRate: 16000 } });
      mute = ctx.createGain();
      mute.gain.value = 0; // the graph only runs when it reaches the destination
      srcNode.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);

      const q = new URLSearchParams({ source, lang });
      for (const t of keyterms.filter(Boolean).slice(0, 20)) q.append("keyterm", t);
      if (speaker) q.set("speaker", speaker);
      if (phoneId) q.set("phone", phoneId);
      const wsUrl = `${location.origin.replace(/^http/, "ws")}/api/room/${roomId}/audio?${q}`;
      const protocols = pass ? ["bearer", token, "pass", pass] : ["bearer", token];
      const ws = new WebSocket(wsUrl, protocols);
      ws.binaryType = "arraybuffer";
      let stopped = false;

      node.port.onmessage = (e) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data.pcm);
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.ready) onReady?.();
        if (typeof m.interim === "string") onInterim?.(m.interim);
        if (m.final) onFinal?.(m.final);
        if (m.error) onError?.(m.error);
      };
      ws.onclose = (e) => {
        if (stopped) return;
        stopped = true;
        teardown();
        onError?.(e.reason || (e.code === 1006 ? "the relay refused the audio link (check key/pass, or the room is gone)" : "the audio link to the relay closed"));
      };
      ws.onerror = () => {};
      return {
        stop() {
          if (stopped) return;
          stopped = true;
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "Finalize" }));
              ws.send(JSON.stringify({ type: "stop" }));
            }
          } catch {}
          try { ws.close(); } catch {}
          teardown();
        },
      };
    } catch (err) {
      teardown();
      throw err;
    }
  }
  window.StageTypeDeepgram = { start };
})();
