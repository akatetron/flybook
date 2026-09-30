/// <reference lib="webworker" />
// Runs the Kokoro text-to-speech model off the main thread so the page stays
// responsive while audio is generated. The model is downloaded once and then
// cached by the browser; after that it works offline.
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
// Relative path because the package's exports map hides its dist/ files.
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";

export type WorkerRequest =
  | { type: "load"; threads: number }
  | { type: "generate"; id: number; text: string; voice: string };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "load-error"; message: string }
  | { type: "audio"; id: number; wav: ArrayBuffer; seconds: number }
  | { type: "error"; id: number; message: string };

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: KokoroTTS | null = null;
const wasmUrl = new URL(ortWasmUrl, self.location.href).href;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

async function load() {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "progress", loaded, total });
  };
  try {
    // Check the runtime binary is really on the website before handing it to
    // the runtime, whose own error for a missing file is unreadable.
    const res = await fetch(wasmUrl, { method: "HEAD" }).catch(() => null);
    if (res && !res.ok) {
      throw new Error(
        "The voice engine file is missing from this website (upload the whole site folder, including assets/*.wasm)."
      );
    }
    // The compact 8-bit model on the CPU (WebAssembly): ~90 MB, fast enough
    // for real-time narration, and the same on phones and computers.
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: progress_callback as never,
    });
    post({ type: "ready" });
  } catch (err) {
    post({ type: "load-error", message: err instanceof Error ? err.message : String(err) });
  }
}

// When the runtime uses several threads it starts extra copies of this bundle
// named "em-pthread"; those must keep the runtime's own message handler.
const isRuntimeThread = self.name?.startsWith("em-pthread");

if (!isRuntimeThread) self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    const wasm = env.backends.onnx.wasm!;
    // transformers.js points this at a CDN by default. Point it at the copy
    // bundled with the app instead (same origin, cached offline). The exact
    // URL matters: left to guess, the runtime asks for an un-hashed filename
    // that doesn't exist on the host.
    wasm.wasmPaths = { wasm: wasmUrl };
    // Threads only work when the page is cross-origin isolated.
    wasm.numThreads = self.crossOriginIsolated ? msg.threads : 1;
    if (!tts) await load();
    else post({ type: "ready" });
    return;
  }
  if (msg.type === "generate") {
    // One inference at a time: the model session can't run concurrently.
    queue = queue.then(() => generate(msg));
  }
};

let queue: Promise<void> = Promise.resolve();

async function generate(msg: Extract<WorkerRequest, { type: "generate" }>) {
  try {
    if (!tts) throw new Error("Voice model not loaded");
    const audio = await tts.generate(msg.text, { voice: msg.voice as never });
    const samples = audio.audio as Float32Array;
    const wav = encodeWav(samples, audio.sampling_rate);
    post({ type: "audio", id: msg.id, wav, seconds: samples.length / audio.sampling_rate }, [wav]);
  } catch (err) {
    post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
}
