// 端末内(ブラウザ内)で Whisper により日本語の文字起こしを行う Web Worker。
// 音声は端末の外へ送信されません。モデルファイルのダウンロードだけが発生し、ブラウザに保存されます。
import { rms, splitSegments } from "./audio-utils.js";

const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";
const MODELS = {
  base: "onnx-community/whisper-base",
  small: "onnx-community/whisper-small",
};
const SILENCE_RMS = 0.0025; // これより静かな区間は文字起こししない(無音での幻聴を防ぐ)

let cache = null; // { key, asr }
const files = new Map();

const post = (msg) => self.postMessage(msg);
const describe = (err) => (err && err.message ? err.message : String(err));

self.onmessage = async (e) => {
  if (e.data.type !== "start") return;
  try {
    await run(e.data);
  } catch (err) {
    post({ type: "error", message: describe(err) });
  }
};

function onProgress(p) {
  if (p.status === "progress" && p.total) {
    files.set(p.file, { loaded: p.loaded, total: p.total });
  } else if (p.status === "done" && files.has(p.file)) {
    const f = files.get(p.file);
    f.loaded = f.total;
  } else {
    return;
  }
  let loaded = 0;
  let total = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  post({ type: "progress", phase: "load", loaded, total });
}

async function loadPipeline(tf, model, device) {
  const id = MODELS[model] || MODELS.small;
  const hasGpu = typeof navigator !== "undefined" && !!navigator.gpu;
  const order = device === "wasm" ? ["wasm"] : device === "webgpu" ? ["webgpu"] : hasGpu ? ["webgpu", "wasm"] : ["wasm"];
  let lastErr;
  for (const dev of order) {
    const key = `${id}|${dev}`;
    if (cache && cache.key === key) return cache.asr;
    files.clear();
    post({ type: "status", text: `モデルを準備中(${dev === "webgpu" ? "GPU" : "CPU"})…` });
    try {
      const asr = await tf.pipeline("automatic-speech-recognition", id, {
        device: dev,
        dtype: dev === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
        progress_callback: onProgress,
      });
      cache = { key, asr };
      return asr;
    } catch (err) {
      lastErr = err;
      post({ type: "status", text: `${dev === "webgpu" ? "GPU" : "CPU"}での準備に失敗しました: ${describe(err)}` });
    }
  }
  throw lastErr;
}

async function run({ model, device, audio }) {
  let tf;
  try {
    tf = await import(TF_URL);
  } catch (err) {
    throw new Error("文字起こしエンジンを読み込めません。ネットワーク接続を確認してください。(" + describe(err) + ")");
  }
  const asr = await loadPipeline(tf, model, device);

  const segments = splitSegments(audio);
  let done = 0;
  post({ type: "progress", phase: "transcribe", done, total: segments.length });
  for (const [start, end] of segments) {
    const seg = audio.subarray(start, end);
    if (rms(seg) >= SILENCE_RMS) {
      const out = await asr(seg, { language: "ja", task: "transcribe", max_new_tokens: 224 });
      const text = (out && out.text ? out.text : "").trim();
      if (text) post({ type: "text", text });
    }
    done++;
    post({ type: "progress", phase: "transcribe", done, total: segments.length });
  }
  post({ type: "done" });
}
