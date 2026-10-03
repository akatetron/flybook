// Main-thread handle on the Kokoro worker: loads the model once, then turns
// text into playable WAV blobs one request at a time.
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

type Listener = (s: ModelState) => void;

const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const SINGLE_THREAD_KEY = "flybook:single-thread";
const DOWNLOADED_KEY = "flybook:model-downloaded";

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

function pickThreads(): number {
  // A device where several threads crashed before stays on one.
  if (flag(SINGLE_THREAD_KEY)) return 1;
  const cores = navigator.hardwareConcurrency || 2;
  // iPhones: two threads roughly halves generation time; more risks running
  // out of memory in Safari.
  if (isIOS()) return Math.min(2, cores);
  return Math.max(1, Math.min(4, cores - 1));
}

class KokoroClient {
  private worker: Worker | null = null;
  private state: ModelState = { phase: "idle" };
  private listeners = new Set<Listener>();
  private nextId = 1;
  private pending = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void; started: number }>();
  private loadPromise: Promise<void> | null = null;
  private threads = 1;
  /** Seconds of compute per second of audio (below 1 = faster than real time). */
  private rtf: number | null = null;

  /** Approximate download size shown to the user before the first load. */
  readonly downloadLabel = "about 90 MB";

  get current() {
    return this.state;
  }

  /** How long this device takes to make one second of speech, once measured. */
  get realTimeFactor(): number | null {
    return this.rtf;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(state: ModelState) {
    this.state = state;
    this.listeners.forEach((fn) => fn(state));
  }

  /** True when the model has been downloaded on this device before. */
  wasDownloaded(): boolean {
    return flag(DOWNLOADED_KEY);
  }

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.set({ phase: "loading", loaded: 0, total: 0 });
    this.loadPromise = this.start(pickThreads()).catch((err: Error) => {
      // Several threads didn't work on this device: retry once with one.
      if (this.threads > 1 && !/download|internet|missing/i.test(err.message)) {
        setFlag(SINGLE_THREAD_KEY);
        this.loadPromise = null;
        this.set({ phase: "loading", loaded: 0, total: 0 });
        return (this.loadPromise = this.start(1));
      }
      throw err;
    });
    return this.loadPromise;
  }

  private start(threads: number): Promise<void> {
    this.threads = threads;
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
            setFlag(DOWNLOADED_KEY);
            this.set({ phase: "ready" });
            resolve();
            break;
          case "load-error": {
            const message = /fetch|network|load failed/i.test(msg.message)
              ? "Couldn't download the voices — check your internet connection."
              : msg.message;
            this.teardown();
            if (this.threads > 1) reject(new Error(message));
            else {
              this.fail(message);
              reject(new Error(message));
            }
            break;
          }
          case "audio": {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (!p) break;
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
            p?.reject(new Error(msg.message));
            break;
          }
        }
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        const message = e.message || "The voice engine stopped (the phone may be low on memory). Tap play to restart it.";
        // A crash with several threads: use one from now on.
        if (this.threads > 1) setFlag(SINGLE_THREAD_KEY);
        if (!ready && this.threads > 1) {
          this.teardown();
          reject(new Error(message));
          return;
        }
        this.fail(message);
        reject(new Error(message));
      };
      worker.postMessage({ type: "load", threads } satisfies WorkerRequest);
    });
  }

  private teardown() {
    this.worker?.terminate();
    this.worker = null;
  }

  private fail(message: string) {
    this.set({ phase: "error", message });
    this.pending.forEach((p) => p.reject(new Error(message)));
    this.pending.clear();
    this.teardown();
    this.loadPromise = null;
  }

  async generate(text: string, voice: string): Promise<Clip> {
    await this.load();
    const id = this.nextId++;
    return new Promise<Clip>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, started: performance.now() });
      this.worker!.postMessage({ type: "generate", id, text, voice } satisfies WorkerRequest);
    });
  }
}

export const kokoro = new KokoroClient();
