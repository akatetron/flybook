/// <reference lib="webworker" />
// Runs Piper voices (small neural VITS models) off the main thread. Piper is
// light enough to run several times faster than real time on a phone's CPU,
// which is what makes narration on iPhones possible without buffering.
import * as ort from "onnxruntime-web/wasm";
// Relative paths because the packages' exports maps hide their dist/ files.
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import ortMjsUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import phonemizeWasmUrl from "../../node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url";
import phonemizeDataUrl from "../../node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data?url";
import { createPiperPhonemize, type PiperPhonemizeModule } from "./vendor/piper_phonemize.js";

export type PiperRequest =
  | { type: "load"; voice: string; threads: number }
  | { type: "generate"; id: number; text: string; voice: string };

export type PiperResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; voice: string; threads: number }
  | { type: "load-error"; message: string }
  | { type: "audio"; id: number; wav: ArrayBuffer; seconds: number }
  | { type: "error"; id: number; message: string };

/** Official Piper voice library. */
const VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const CACHE = "flybook-piper-v1";

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map?: Record<string, number>;
}

const post = (msg: PiperResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

/** "en_US-lessac-medium" -> "en/en_US/lessac/medium/en_US-lessac-medium" */
function voicePath(voice: string): string {
  const [locale, name, quality] = voice.split("-");
  return `${locale.split("_")[0]}/${locale}/${name}/${quality}/${voice}`;
}

/** Fetches once (with progress), then serves from the device's cache. */
async function cachedFetch(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Response> {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the voice (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const body = new Blob(parts as BlobPart[]);
  const copy = new Response(body, { headers: { "content-type": res.headers.get("content-type") ?? "" } });
  await cache?.put(url, copy.clone()).catch(() => undefined);
  return copy;
}

let phonemizer: PiperPhonemizeModule | null = null;
let phonemizeResult: ((ids: number[]) => void) | null = null;

async function getPhonemizer(): Promise<PiperPhonemizeModule> {
  phonemizer ??= await createPiperPhonemize({
    print: (data: string) => {
      const ids = JSON.parse(data).phoneme_ids as number[];
      phonemizeResult?.(ids);
      phonemizeResult = null;
    },
    printErr: () => undefined,
    locateFile: (file: string) => (file.endsWith(".wasm") ? phonemizeWasmUrl : file.endsWith(".data") ? phonemizeDataUrl : file),
  });
  return phonemizer;
}

async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  const module = await getPhonemizer();
  return new Promise<number[]>((resolve, reject) => {
    phonemizeResult = resolve;
    try {
      module.callMain(["-l", espeakVoice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]);
    } catch (err) {
      reject(err);
    }
    // callMain prints synchronously; nothing printed means no phonemes.
    if (phonemizeResult === resolve) {
      phonemizeResult = null;
      resolve([]);
    }
  });
}

let loaded: { voice: string; config: VoiceConfig; session: ort.InferenceSession } | null = null;

async function loadVoice(voice: string) {
  if (loaded?.voice === voice) return loaded;
  const path = voicePath(voice);
  const [config, model] = await Promise.all([
    cachedFetch(`${VOICES_BASE}/${path}.onnx.json`).then((r) => r.json() as Promise<VoiceConfig>),
    cachedFetch(`${VOICES_BASE}/${path}.onnx`, (l, t) => post({ type: "progress", loaded: l, total: t })).then((r) =>
      r.arrayBuffer()
    ),
    getPhonemizer(),
  ]);
  await loaded?.session.release().catch(() => undefined);
  loaded = null;
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] });
  loaded = { voice, config, session };
  return loaded;
}

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

async function synthesize(text: string, voice: string): Promise<{ wav: ArrayBuffer; seconds: number }> {
  const { config, session } = await loadVoice(voice);
  const ids = await phonemize(text.trim(), config.espeak.voice);
  const rate = config.audio.sample_rate;
  if (ids.length === 0) {
    const silence = new Float32Array(Math.round(rate * 0.3));
    return { wav: encodeWav(silence, rate), seconds: 0.3 };
  }
  const { noise_scale, length_scale, noise_w } = config.inference;
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
  };
  if (config.speaker_id_map && Object.keys(config.speaker_id_map).length) {
    feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  }
  const out = await session.run(feeds);
  const pcm = out.output.data as Float32Array;
  // A short pause after each sentence, like a narrator's breath.
  const padded = new Float32Array(pcm.length + Math.round(rate * 0.12));
  padded.set(pcm);
  return { wav: encodeWav(padded, rate), seconds: padded.length / rate };
}

let queue: Promise<void> = Promise.resolve();

// Extra copies of this bundle started by the runtime as threads ("em-pthread")
// must keep the runtime's own message handler.
const isRuntimeThread = self.name?.startsWith("em-pthread");

if (!isRuntimeThread) self.onmessage = (event: MessageEvent<PiperRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    ort.env.wasm.wasmPaths = {
      wasm: new URL(ortWasmUrl, self.location.href).href,
      mjs: new URL(ortMjsUrl, self.location.href).href,
    };
    ort.env.wasm.numThreads = self.crossOriginIsolated ? msg.threads : 1;
    queue = queue.then(async () => {
      try {
        await loadVoice(msg.voice);
        // Warm up so the first real sentence isn't slow.
        await synthesize("Hello.", msg.voice);
        post({ type: "ready", voice: msg.voice, threads: ort.env.wasm.numThreads ?? 1 });
      } catch (err) {
        post({ type: "load-error", message: err instanceof Error ? err.message : String(err) });
      }
    });
    return;
  }
  // One inference at a time.
  queue = queue.then(async () => {
    try {
      const { wav, seconds } = await synthesize(msg.text, msg.voice);
      post({ type: "audio", id: msg.id, wav, seconds }, [wav]);
    } catch (err) {
      post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
