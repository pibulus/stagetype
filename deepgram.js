// StageType multi-engine speech capture (16 kHz AudioWorklet + RMS Voice Activity Detection).
// Supports three studio engines alongside native Browser Speech:
// 1. start(...)         -> Deepgram Nova-3 WebSocket with 600ms pre-roll + 9s silence auto-hibernate
// 2. startTurbo(...)    -> Dual-Track Cloud Turbo (0ms live interim + 10-15s VAD-gated Groq Whisper-v3-Turbo WAVs)
// 3. startOnDevice(...) -> 100% local Moonshine / Whisper WebGPU/WASM Web Worker ($0/hr, zero audio leaves device)
(() => {
  const WORKLET = `
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.target = (o.processorOptions && o.processorOptions.targetRate) || 16000;
    this.buf = [];
    this.acc = 0;
    this.n = 0;
    this.pos = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ratio = sampleRate / this.target;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.pos += 1;
      while (this.pos >= ratio) {
        this.pos -= ratio;
        this.buf.push(this.n ? this.acc / this.n : ch[i]);
        this.acc = 0; this.n = 0;
      }
    }
    if (this.buf.length >= 1600) { // 100 ms @ 16 kHz
      const len = this.buf.length;
      const out = new Int16Array(len);
      const f32 = new Float32Array(len);
      let sumSq = 0;
      for (let i = 0; i < len; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        f32[i] = s;
        sumSq += s * s;
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const rms = Math.sqrt(sumSq / len);
      this.port.postMessage({ pcm: out.buffer, f32: f32.buffer, rms }, [out.buffer, f32.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor("pcm16-downsampler", Pcm16Downsampler);`;

  const encodeB64Url = (s) => {
    const bytes = new TextEncoder().encode(String(s));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  async function openMicWorklet() {
    if (!window.AudioWorkletNode) throw new Error("this browser does not support AudioWorklet");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    let ctx = null, srcNode = null, node = null, mute = null;
    const teardown = () => {
      try {
        if (node) { node.port.onmessage = null; node.disconnect(); }
        srcNode?.disconnect();
        mute?.disconnect();
      } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close?.().catch(() => {});
    };
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      try { ctx = new AudioCtx({ sampleRate: 16000 }); } catch { ctx = new AudioCtx(); }
      await ctx.resume();
      const modUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      try { await ctx.audioWorklet.addModule(modUrl); } finally { URL.revokeObjectURL(modUrl); }
      srcNode = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, "pcm16-downsampler", { processorOptions: { targetRate: 16000 } });
      mute = ctx.createGain();
      mute.gain.value = 0;
      srcNode.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      return { node, teardown };
    } catch (err) {
      teardown();
      throw err;
    }
  }

  function encodeWav16k(pcmChunks) {
    let samples = 0;
    for (const c of pcmChunks) samples += c.length;
    const dataBytes = samples * 2;
    const buf = new ArrayBuffer(44 + dataBytes);
    const v = new DataView(buf);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    v.setUint32(4, 36 + dataBytes, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, "data");
    v.setUint32(40, dataBytes, true);
    const out = new Int16Array(buf, 44, samples);
    let offset = 0;
    for (const c of pcmChunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return buf;
  }

  // Optional parallel Browser Speech helper solely for 0ms interim preview during Turbo / On-Device capture
  function startInterimShadow(lang, onInterim) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec || !onInterim) return { stop() {} };
    let active = true;
    let rec = null;
    let restartTimer = null;
    const boot = () => {
      if (!active) return;
      try {
        rec = new Rec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = lang === "multi" ? "en-US" : (lang || "en-US");
        rec.onresult = (e) => {
          let txt = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (!e.results[i].isFinal) txt += e.results[i][0].transcript + " ";
          }
          const trimmed = txt.trim();
          if (trimmed) onInterim(trimmed);
        };
        rec.onerror = () => {};
        rec.onend = () => {
          if (active) restartTimer = setTimeout(boot, 250);
        };
        rec.start();
      } catch {}
    };
    boot();
    return {
      stop() {
        active = false;
        clearTimeout(restartTimer);
        try { rec?.stop(); } catch {}
      },
    };
  }

  // 1. Deepgram Nova-3 Streaming (with 600ms rolling pre-roll + 9s silence socket hibernate)
  async function start({
    roomId, token, source = "mic", lang = "en", keyterms = [], speaker = "", phoneId = "", pass = "",
    onInterim, onFinal, onError, onReady,
  }) {
    if (!window.WebSocket) throw new Error("this browser can't stream audio");
    const { node, teardown } = await openMicWorklet();
    const q = new URLSearchParams({ source, lang });
    for (const t of keyterms.filter(Boolean).slice(0, 20)) q.append("keyterm", t);
    if (speaker) q.set("speaker", speaker);
    if (phoneId) q.set("phone", phoneId);
    const wsUrl = `${location.origin.replace(/^http/, "ws")}/api/room/${roomId}/audio?${q}`;
    const protocols = pass ? ["bearer", token, "pass-b64", encodeB64Url(pass)] : ["bearer", token];

    const SPEECH_RMS = 0.005;
    const HIBERNATE_SILENCE_MS = 9000;
    const PREROLL_CHUNKS = 6; // 600 ms
    const preRoll = [];
    let ws = null;
    let stopped = false;
    let hibernating = false;
    let hadSpeech = false;
    let silentMs = 0;

    const connectSocket = (flushPreRoll) => {
      if (stopped) return;
      hibernating = false;
      const sock = new WebSocket(wsUrl, protocols);
      sock.binaryType = "arraybuffer";
      ws = sock;
      sock.onopen = () => {
        if (sock !== ws || stopped) return;
        if (flushPreRoll && preRoll.length) {
          for (const buf of preRoll.splice(0)) {
            try { sock.send(buf); } catch { break; }
          }
        }
      };
      sock.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.ready) onReady?.();
        if (typeof m.interim === "string") onInterim?.(m.interim);
        if (m.final) { hadSpeech = true; onFinal?.(m.final); }
        if (m.error) onError?.(m.error);
      };
      sock.onclose = (e) => {
        if (stopped || hibernating || sock !== ws) return;
        stopped = true;
        teardown();
        onError?.(
          e.reason ||
            (e.code === 1006 ? "the relay refused the audio link (check pass, or the room is gone)" : "the audio link to the relay closed"),
        );
      };
      sock.onerror = () => {};
    };

    connectSocket(false);

    node.port.onmessage = (e) => {
      if (stopped) return;
      const { pcm, rms = 0 } = e.data;
      if (rms >= SPEECH_RMS) {
        hadSpeech = true;
        silentMs = 0;
        if (hibernating || !ws || ws.readyState === WebSocket.CLOSED) {
          preRoll.push(pcm);
          if (preRoll.length > PREROLL_CHUNKS) preRoll.shift();
          connectSocket(true);
          return;
        }
      } else {
        silentMs += 100;
        if (hadSpeech && !hibernating && silentMs >= HIBERNATE_SILENCE_MS && ws && ws.readyState === WebSocket.OPEN) {
          // Stop accruing open-socket Deepgram charges during prolonged pauses / Q&A
          hibernating = true;
          const old = ws;
          ws = null;
          try {
            old.send(JSON.stringify({ type: "Finalize" }));
            old.send(JSON.stringify({ type: "stop" }));
            old.close(1000, "silence hibernate");
          } catch {}
          return;
        }
      }

      if (hibernating) {
        preRoll.push(pcm);
        if (preRoll.length > PREROLL_CHUNKS) preRoll.shift();
        return;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcm);
      } else {
        preRoll.push(pcm);
        if (preRoll.length > PREROLL_CHUNKS) preRoll.shift();
      }
    };

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "Finalize" }));
            ws.send(JSON.stringify({ type: "stop" }));
          }
        } catch {}
        try { ws?.close(); } catch {}
        teardown();
      },
    };
  }

  // 2. Cloud Turbo: Dual-Track (0ms live interim + 10-15s VAD-gated Groq Whisper-v3-Turbo WAVs)
  async function startTurbo({
    roomId, token, source = "mic", lang = "en", keyterms = [], speaker = "", phoneId = "", pass = "",
    onInterim, onFinal, onError, onReady,
  }) {
    const { node, teardown } = await openMicWorklet();
    const shadow = startInterimShadow(lang, onInterim);
    let stopped = false;
    let inFlight = Promise.resolve();

    const SPEECH_RMS = 0.0055;
    const PREROLL_MAX = 4; // 400 ms pre-roll
    const OVERHANG_CHUNKS = 5; // 500 ms trailing consonant tail
    const preRoll = [];
    let speechChunks = []; // Int16Array[]
    let speechMs = 0;
    let overhangLeft = 0;
    let pauseMs = 0;

    const q = new URLSearchParams({ source, lang });
    for (const t of keyterms.filter(Boolean).slice(0, 20)) q.append("keyterm", t);
    if (speaker) q.set("speaker", speaker);
    if (phoneId) q.set("phone", phoneId);
    const endpoint = `/api/room/${roomId}/transcribe?${q}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "audio/wav",
      ...(pass ? { "x-stagetype-pass": encodeB64Url(pass) } : {}),
    };

    const flushUtterance = () => {
      if (!speechChunks.length || speechMs < 400) {
        speechChunks = [];
        speechMs = 0;
        pauseMs = 0;
        return;
      }
      const wav = encodeWav16k(speechChunks);
      speechChunks = [];
      speechMs = 0;
      pauseMs = 0;
      inFlight = inFlight.then(async () => {
        try {
          const r = await fetch(endpoint, { method: "POST", headers, body: wav });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            if (r.status === 401 || r.status === 403 || r.status === 503) {
              onError?.(d.error || `HTTP ${r.status}`);
            }
            return;
          }
          if (d.text) onFinal?.(d.text);
          else onInterim?.("");
        } catch {}
      });
    };

    onReady?.();

    node.port.onmessage = (e) => {
      if (stopped) return;
      const { pcm, rms = 0 } = e.data;
      const chunk = new Int16Array(pcm);

      if (rms >= SPEECH_RMS) {
        if (speechChunks.length === 0 && preRoll.length) {
          for (const pr of preRoll.splice(0)) {
            speechChunks.push(pr);
            speechMs += 100;
          }
        }
        speechChunks.push(chunk);
        speechMs += 100;
        overhangLeft = OVERHANG_CHUNKS;
        pauseMs = 0;
        if (speechMs >= 15_000) flushUtterance();
      } else if (overhangLeft > 0) {
        overhangLeft--;
        speechChunks.push(chunk);
        speechMs += 100;
      } else {
        preRoll.push(chunk);
        if (preRoll.length > PREROLL_MAX) preRoll.shift();
        if (speechChunks.length > 0) {
          pauseMs += 100;
          // Hit Groq's 10s billing floor with zero rounding waste on normal flow,
          // while still settling standalone short remarks after a 2.3s full pause.
          if ((speechMs >= 10_200 && pauseMs >= 500) || (speechMs >= 1_100 && pauseMs >= 2_300)) {
            flushUtterance();
          }
        }
      }
    };

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        shadow.stop();
        flushUtterance();
        teardown();
      },
    };
  }

  // 3. On-Device Studio: Moonshine Base (EN) / Whisper Base (Multilingual) in a WebGPU/WASM Worker ($0/hr)
  let sharedWorker = null;
  let workerReqId = 0;
  const workerPending = new Map();

  function getSttWorker() {
    if (sharedWorker) return sharedWorker;
    sharedWorker = new Worker("/stt_worker.js", { type: "module" });
    sharedWorker.onmessage = (e) => {
      const { id, type, text, error, progress } = e.data || {};
      const entry = workerPending.get(id);
      if (!entry) return;
      if (type === "progress") {
        entry.onProgress?.(progress);
        return;
      }
      workerPending.delete(id);
      if (type === "error") entry.reject(new Error(error || "local model error"));
      else entry.resolve(text || "");
    };
    sharedWorker.onerror = (err) => {
      for (const [, entry] of workerPending) entry.reject(new Error(err?.message || "worker crashed"));
      workerPending.clear();
    };
    return sharedWorker;
  }

  function callWorker(payload, onProgress) {
    const w = getSttWorker();
    const id = ++workerReqId;
    return new Promise((resolve, reject) => {
      workerPending.set(id, { resolve, reject, onProgress });
      const transfer = payload.audio instanceof Float32Array ? [payload.audio.buffer] : [];
      w.postMessage({ id, ...payload }, transfer);
    });
  }

  async function startOnDevice({ lang = "en", onInterim, onFinal, onError, onReady, onStatus }) {
    const { node, teardown } = await openMicWorklet();
    const shadow = startInterimShadow(lang, onInterim);
    let stopped = false;
    let inferQueue = Promise.resolve();

    try {
      onStatus?.("Loading on-device model…");
      await callWorker({ type: "load", lang }, (pct) => {
        if (!stopped) onStatus?.(`Loading model ${pct}%…`);
      });
    } catch (err) {
      shadow.stop();
      teardown();
      throw err;
    }
    if (stopped) {
      shadow.stop();
      teardown();
      return { stop() {} };
    }
    onStatus?.("");
    onReady?.();

    const SPEECH_RMS = 0.0055;
    const PREROLL_MAX = 4;
    const OVERHANG_CHUNKS = 5;
    const preRoll = [];
    let speechFloats = []; // Float32Array[]
    let speechMs = 0;
    let overhangLeft = 0;
    let pauseMs = 0;

    const flushLocal = () => {
      if (!speechFloats.length || speechMs < 600) {
        speechFloats = [];
        speechMs = 0;
        pauseMs = 0;
        return;
      }
      let total = 0;
      for (const c of speechFloats) total += c.length;
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of speechFloats) { merged.set(c, off); off += c.length; }
      speechFloats = [];
      speechMs = 0;
      pauseMs = 0;
      inferQueue = inferQueue.then(async () => {
        if (stopped) return;
        try {
          const text = await callWorker({ type: "transcribe", audio: merged, lang });
          if (text && !stopped) onFinal?.(text);
        } catch (err) {
          if (!stopped) onError?.(err.message);
        }
      });
    };

    node.port.onmessage = (e) => {
      if (stopped) return;
      const { f32, rms = 0 } = e.data;
      const chunk = new Float32Array(f32);
      if (rms >= SPEECH_RMS) {
        if (speechFloats.length === 0 && preRoll.length) {
          for (const pr of preRoll.splice(0)) { speechFloats.push(pr); speechMs += 100; }
        }
        speechFloats.push(chunk);
        speechMs += 100;
        overhangLeft = OVERHANG_CHUNKS;
        pauseMs = 0;
        if (speechMs >= 7_500) flushLocal();
      } else if (overhangLeft > 0) {
        overhangLeft--;
        speechFloats.push(chunk);
        speechMs += 100;
      } else {
        preRoll.push(chunk);
        if (preRoll.length > PREROLL_MAX) preRoll.shift();
        if (speechFloats.length > 0) {
          pauseMs += 100;
          if (speechMs >= 800 && pauseMs >= 650) flushLocal();
        }
      }
    };

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        shadow.stop();
        flushLocal();
        teardown();
      },
    };
  }

  window.StageTypeDeepgram = { start, startTurbo, startOnDevice };
})();
