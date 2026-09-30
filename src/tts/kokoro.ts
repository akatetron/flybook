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
  seconds: number;
}

type Listener = (s: ModelState) => void;

function pickThreads(): number {
  // iOS Safari is prone to running out of memory with many wasm threads.
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) return 1;
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
}

const DOWNLOADED_KEY = "flybook:model-downloaded";

class KokoroClient {
  private worker: Worker | null = null;
  private state: ModelState = { phase: "idle" };
  private listeners = new Set<Listener>();
  private nextId = 1;
  private pending = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
  private loadPromise: Promise<void> | null = null;

  /** Approximate download size shown to the user before the first load. */
  readonly downloadLabel = "about 90 MB";

  get current() {
    return this.state;
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
    try {
      return localStorage.getItem(DOWNLOADED_KEY) === "1";
    } catch {
      return false;
    }
  }

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.set({ phase: "loading", loaded: 0, total: 0 });
    this.loadPromise = new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        switch (msg.type) {
          case "progress":
            this.set({ phase: "loading", loaded: msg.loaded, total: msg.total });
            break;
          case "ready":
            try {
              localStorage.setItem(DOWNLOADED_KEY, "1");
            } catch {
              /* ignore */
            }
            this.set({ phase: "ready" });
            resolve();
            break;
          case "load-error": {
            const message = /fetch|network|load failed/i.test(msg.message)
              ? "Couldn't download the voices — check your internet connection."
              : msg.message;
            this.fail(message);
            reject(new Error(message));
            break;
          }
          case "audio": {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            const url = URL.createObjectURL(new Blob([msg.wav], { type: "audio/wav" }));
            p?.resolve({ url, seconds: msg.seconds });
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
        const message = e.message || "The voice engine crashed (the device may be low on memory).";
        this.fail(message);
        reject(new Error(message));
      };
      worker.postMessage({ type: "load", threads: pickThreads() } satisfies WorkerRequest);
    });
    return this.loadPromise;
  }

  private fail(message: string) {
    this.set({ phase: "error", message });
    this.pending.forEach((p) => p.reject(new Error(message)));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.loadPromise = null;
  }

  async generate(text: string, voice: string): Promise<Clip> {
    await this.load();
    const id = this.nextId++;
    return new Promise<Clip>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: "generate", id, text, voice } satisfies WorkerRequest);
    });
  }
}

export const kokoro = new KokoroClient();
