// Main-thread handle on the Kokoro worker: loads the model once, then turns
// text into playable WAV blobs one request at a time.
//
// It picks the fastest way this device can run the voice — the GPU on
// computers whose browser offers WebGPU, otherwise the CPU with two threads,
// otherwise one — and steps down by itself if a mode fails, hangs, or crashes
// the whole page (detected on the next visit).
import type { WorkerRequest, WorkerResponse } from "./kokoro.worker";

export type ModelState =
  | { phase: "idle" }
  | { phase: "loading"; loaded: number; total: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export interface Clip {
  url: string;
  blob: Blob;
  seconds: number;
}

export interface EngineInfo {
  device: "webgpu" | "wasm";
  threads: number;
  isolated: boolean;
}

type Device = EngineInfo["device"];
type Listener = (s: ModelState) => void;

const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const NO_GPU_KEY = "flybook:no-webgpu";
const SINGLE_THREAD_KEY = "flybook:single-thread";
const DOWNLOADED_KEY = "flybook:model-downloaded";
const DOWNLOADED_GPU_KEY = "flybook:model-downloaded-gpu";
/** Set while the engine is starting or running; still there on the next
 *  visit means the page crashed (it is cleared when the page is left normally). */
const ATTEMPT_KEY = "flybook:engine-attempt";
/** Even the safest mode crashed the page on this device. */
const CRASHED_KEY = "flybook:engine-crashed";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function clear(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string, value = "1") {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function gpuAvailable(): Promise<boolean> {
  // Phones can't hold the large GPU model in memory: Safari kills the page.
  if (isIOS() || /Android|Mobile/i.test(navigator.userAgent) || flag(NO_GPU_KEY)) return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function cpuThreads(): number {
  if (flag(SINGLE_THREAD_KEY)) return 1;
  const cores = navigator.hardwareConcurrency || 2;
  if (isIOS()) return Math.min(2, cores);
  return Math.max(1, Math.min(4, cores - 1));
}

/** A request took so long the engine is assumed stuck. */
class EngineHung extends Error {}

/** No sentence should take this long; first one after loading gets extra time. */
const HANG_MS = 45_000;
const FIRST_HANG_MS = 120_000;

interface Pending {
  resolve: (c: Clip) => void;
  reject: (e: Error) => void;
  started: number;
  timer: ReturnType<typeof setTimeout>;
}

class KokoroClient {
  private worker: Worker | null = null;
  private state: ModelState = { phase: "idle" };
  private listeners = new Set<Listener>();
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private loadPromise: Promise<void> | null = null;
  private attempt: { device: Device; threads: number } | null = null;
  private engine: EngineInfo | null = null;
  private servedSinceLoad = 0;
  /** Seconds of compute per second of audio (below 1 = faster than real time). */
  private rtf: number | null = null;

  get current() {
    return this.state;
  }

  /** How the voice is running on this device, once loaded. */
  get info(): EngineInfo | null {
    return this.engine;
  }

  /** How long this device takes to make one second of speech, once measured. */
  get realTimeFactor(): number | null {
    return this.rtf;
  }

  /** Download size for the next load, shown before asking to download. */
  get downloadLabel(): string {
    const phone = isIOS() || /Android|Mobile/i.test(navigator.userAgent);
    return phone || flag(NO_GPU_KEY) || !("gpu" in navigator) ? "about 90 MB" : "about 330 MB";
  }

  /** The voice crashed this page before, even in its safest mode. */
  crashedBefore(): boolean {
    return flag(CRASHED_KEY);
  }

  constructor() {
    // The engine was starting when the page last died: that mode is too much
    // for this device, so step down before anything tries it again.
    const attempt = read(ATTEMPT_KEY);
    if (attempt) {
      clear(ATTEMPT_KEY);
      const [device, threads] = attempt.split("/");
      if (!this.stepDown(device === "webgpu" ? "webgpu" : "wasm", Number(threads) || 1)) {
        // Even one core was too much: stay on one, and only start when asked.
        setFlag(SINGLE_THREAD_KEY);
        setFlag(CRASHED_KEY);
      }
    }
    // Leaving the page normally isn't a crash.
    const left = () => clear(ATTEMPT_KEY);
    const back = () => {
      if (document.visibilityState === "hidden") left();
      else if (this.worker && this.attempt) setFlag(ATTEMPT_KEY, `${this.attempt.device}/${this.attempt.threads}`);
    };
    window.addEventListener("pagehide", left);
    document.addEventListener("visibilitychange", back);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(state: ModelState) {
    this.state = state;
    this.listeners.forEach((fn) => fn(state));
  }

  /** True when a voice model has been downloaded on this device before. */
  wasDownloaded(): boolean {
    return flag(DOWNLOADED_KEY) || flag(DOWNLOADED_GPU_KEY);
  }

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.set({ phase: "loading", loaded: 0, total: 0 });
    this.loadPromise = this.loadBest();
    return this.loadPromise;
  }

  /** Tries the fastest mode first and steps down until one works. */
  private async loadBest(): Promise<void> {
    for (;;) {
      const device: Device = (await gpuAvailable()) ? "webgpu" : "wasm";
      const threads = device === "wasm" ? cpuThreads() : 1;
      try {
        await this.start(device, threads);
        return;
      } catch (err) {
        const message = (err as Error).message;
        // Network problems won't be fixed by a different mode.
        if (/download|internet|missing/i.test(message) || !this.stepDown(device, threads)) {
          this.fail(message);
          throw err;
        }
        this.set({ phase: "loading", loaded: 0, total: 0 });
      }
    }
  }

  /** Remembers that a mode failed on this device. False when nothing is left to try. */
  private stepDown(device: Device, threads: number): boolean {
    if (device === "webgpu") {
      setFlag(NO_GPU_KEY);
      return true;
    }
    if (threads > 1) {
      setFlag(SINGLE_THREAD_KEY);
      return true;
    }
    return false;
  }

  private start(device: Device, threads: number): Promise<void> {
    this.attempt = { device, threads };
    setFlag(ATTEMPT_KEY, `${device}/${threads}`);
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      let ready = false;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        switch (msg.type) {
          case "progress":
            this.set({ phase: "loading", loaded: msg.loaded, total: msg.total });
            break;
          case "ready":
            ready = true;
            clear(CRASHED_KEY);
            setFlag(msg.device === "webgpu" ? DOWNLOADED_GPU_KEY : DOWNLOADED_KEY);
            this.engine = { device: msg.device, threads: msg.threads, isolated: msg.isolated };
            this.servedSinceLoad = 0;
            this.set({ phase: "ready" });
            resolve();
            break;
          case "load-error": {
            clear(ATTEMPT_KEY);
            const message = /fetch|network|load failed/i.test(msg.message)
              ? "Couldn't download the voices — check your internet connection."
              : msg.message;
            this.teardown();
            reject(new Error(message));
            break;
          }
          case "audio": {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (!p) break;
            clearTimeout(p.timer);
            this.servedSinceLoad++;
            const elapsed = (performance.now() - p.started) / 1000;
            if (msg.seconds > 0.5) {
              const sample = elapsed / msg.seconds;
              this.rtf = this.rtf === null ? sample : this.rtf * 0.8 + sample * 0.2;
            }
            const blob = new Blob([msg.wav], { type: "audio/wav" });
            p.resolve({ url: URL.createObjectURL(blob), blob, seconds: msg.seconds });
            break;
          }
          case "error": {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (p) clearTimeout(p.timer);
            p?.reject(new Error(msg.message));
            break;
          }
        }
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        const message = e.message || "The voice engine stopped (the phone may be low on memory).";
        if (!ready) {
          this.teardown();
          reject(new Error(message));
          return;
        }
        // Crashed while working: use a safer mode next time, and let the
        // next request start it again.
        this.stepDown(device, threads);
        this.restart(new EngineHung(message));
      };
      worker.postMessage({ type: "load", device, threads } satisfies WorkerRequest);
    });
  }

  private teardown() {
    this.worker?.terminate();
    this.worker = null;
    clear(ATTEMPT_KEY);
  }

  /** Drops a stuck or crashed engine; the next request loads a fresh one. */
  private restart(reason: Error) {
    this.teardown();
    this.engine = null;
    this.loadPromise = null;
    this.set({ phase: "idle" });
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(reason);
    });
    this.pending.clear();
  }

  private fail(message: string) {
    this.set({ phase: "error", message });
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    });
    this.pending.clear();
    this.teardown();
    this.loadPromise = null;
  }

  async generate(text: string, voice: string): Promise<Clip> {
    // One retry: if the engine hung or crashed, it is restarted in a safer mode.
    for (let attempt = 0; ; attempt++) {
      await this.load();
      try {
        return await this.request(text, voice);
      } catch (err) {
        if (!(err instanceof EngineHung) || attempt >= 1) throw err;
      }
    }
  }

  private request(text: string, voice: string): Promise<Clip> {
    const id = this.nextId++;
    return new Promise<Clip>((resolve, reject) => {
      const limit = this.servedSinceLoad === 0 ? FIRST_HANG_MS : HANG_MS;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        const a = this.attempt;
        if (a) this.stepDown(a.device, a.threads);
        this.restart(new EngineHung("The voice engine got stuck; restarting it."));
      }, limit);
      this.pending.set(id, { resolve, reject, started: performance.now(), timer });
      this.worker!.postMessage({ type: "generate", id, text, voice } satisfies WorkerRequest);
    });
  }
}

export const kokoro = new KokoroClient();
