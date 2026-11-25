// StageType On-Device Speech Worker (Browser-Only ESM, $0/hr, zero audio leaves the device).
// Routes English talks to UsefulSensors Moonshine Base ONNX (dynamic length, no 30s zero-padding)
// and Spanish / multilingual talks to Whisper Base ONNX via WebGPU with automatic WASM fallback.

import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

const HALLUCINATION_RE =
  /^(?:\[.*?\]|\(.*?\)|\*.*?\*|thank you(?: for watching| very much)?\.?|thanks for watching\.?|subtitles by .*|amara\.org.*|you|\.+|\s*)$/i;

let transcriber = null;
let loadedModelId = null;
let queue = Promise.resolve();

function modelForLang(lang) {
  const short = String(lang || "en").toLowerCase().split("-")[0];
  return short === "en" ? "onnx-community/moonshine-base-ONNX" : "onnx-community/whisper-base";
}

function whisperLangCode(lang) {
  const short = String(lang || "en").toLowerCase().split("-")[0];
  if (!short || short === "multi") return undefined;
  return short === "yue" ? "chinese" : short;
}

async function hasWebGPU() {
  try {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function ensurePipeline(modelId, id) {
  if (transcriber && loadedModelId === modelId) return transcriber;
  if (transcriber) {
    try {
      await transcriber.dispose?.();
    } catch { /* ignore */ }
    transcriber = null;
    loadedModelId = null;
  }
  const onProgress = (info) => {
    if (info && typeof info.progress === "number") {
      self.postMessage({ id, type: "progress", progress: Math.round(info.progress), modelId });
    }
  };
  const dtype = { encoder_model: "fp32", decoder_model_merged: "q4" };
  if (await hasWebGPU()) {
    try {
      transcriber = await pipeline("automatic-speech-recognition", modelId, {
        device: "webgpu",
        dtype,
        progress_callback: onProgress,
      });
      loadedModelId = modelId;
      return transcriber;
    } catch {
      // Fall back cleanly to single-thread WASM
    }
  }
  transcriber = await pipeline("automatic-speech-recognition", modelId, {
    device: "wasm",
    dtype,
    progress_callback: onProgress,
  });
  loadedModelId = modelId;
  return transcriber;
}

self.onmessage = (event) => {
  queue = queue.then(async () => {
    const { id, type, audio, lang } = event.data || {};
    const modelId = modelForLang(lang);
    try {
      const asr = await ensurePipeline(modelId, id);
      if (type === "load") {
        self.postMessage({ id, type: "ready", modelId });
        return;
      }
      if (type === "transcribe" && audio instanceof Float32Array) {
        const isWhisper = modelId.includes("whisper");
        const opts = isWhisper ? { language: whisperLangCode(lang), task: "transcribe" } : {};
        const out = await asr(audio, opts);
        const raw = (typeof out?.text === "string" ? out.text : "").trim();
        const text = HALLUCINATION_RE.test(raw) ? "" : raw;
        self.postMessage({ id, type: "result", text });
      }
    } catch (err) {
      self.postMessage({ id, type: "error", error: err?.message || String(err) });
    }
  });
};
