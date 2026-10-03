// Main-thread handle on the Piper worker: downloads a voice once (~60 MB,
// cached on the device), then turns text into WAV clips one at a time.
import type { PiperRequest, PiperResponse } from "./piper.worker";
import type { Clip, ModelState } from "./kokoro";

type Listener = (s: ModelState) => void;

const DOWNLOADED_KEY = "flybook:piper-downloaded";
const HANG_MS = 30_000;

function downloadedVoices(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

class PiperClient {
  private worker: Worker | null = null;
  private state: ModelState = { phase: "idle" };
  private listeners = new Set<Listener>();
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (c: Clip) => void; reject: (e: Error) => void; started: number; timer: ReturnType<typeof setTimeout> }
  >();
  private loading: { voice: string; promise: Promise<void> } | null = null;
  private readyVoice: string | null = null;
  private threads = 1;
  private rtf: number | null = null;

  get current() {
    return this.state;
  }
  get realTimeFactor() {
    return this.rtf;
  }
  get label(): string | null {
    return this.readyVoice ? `Piper · CPU · ${this.threads} ${this.threads === 1 ? "core" : "cores"}` : null;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(state: ModelState) {
    this.state = state;
    this.listeners.forEach((fn) => fn(state));
  }

  wasDownloaded(voice: string): boolean {
    return downloadedVoices().includes(voice);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./piper.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<PiperResponse>) => this.onMessage(event.data);
    worker.onerror = (e) => {
      e.preventDefault?.();
      this.reset(e.message || "The voice engine stopped. Tap play to restart it.", true);
    };
    this.worker = worker;
    return worker;
  }

  private loadResolve: (() => void) | null = null;
  private loadReject: ((e: Error) => void) | null = null;

  private onMessage(msg: PiperResponse) {
    switch (msg.type) {
      case "progress":
        this.set({ phase: "loading", loaded: msg.loaded, total: msg.total });
        break;
      case "ready": {
        this.readyVoice = msg.voice;
        this.threads = msg.threads;
        const list = downloadedVoices();
        if (!list.includes(msg.voice)) {
          try {
            localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...list, msg.voice]));
          } catch {
            /* ignore */
          }
        }
        this.set({ phase: "ready" });
        this.loadResolve?.();
        break;
      }
      case "load-error": {
        const message = /fetch|network|load failed|download/i.test(msg.message)
          ? "Couldn't download the voice — check your internet connection."
          : msg.message;
        this.loading = null;
        this.set({ phase: "error", message });
        this.loadReject?.(new Error(message));
        break;
      }
      case "audio": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) break;
        clearTimeout(p.timer);
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
  }

  private reset(message: string, asError: boolean) {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.readyVoice = null;
    this.set(asError ? { phase: "error", message } : { phase: "idle" });
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    });
    this.pending.clear();
  }

  load(voice: string): Promise<void> {
    if (this.readyVoice === voice && this.worker) return Promise.resolve();
    if (this.loading?.voice === voice) return this.loading.promise;
    this.set({ phase: "loading", loaded: 0, total: 0 });
    const promise = new Promise<void>((resolve, reject) => {
      this.loadResolve = resolve;
      this.loadReject = reject;
    });
    this.loading = { voice, promise };
    const threads = Math.min(2, navigator.hardwareConcurrency || 1);
    this.ensureWorker().postMessage({ type: "load", voice, threads } satisfies PiperRequest);
    return promise;
  }

  async generate(text: string, voice: string): Promise<Clip> {
    await this.load(voice);
    const id = this.nextId++;
    return new Promise<Clip>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) this.reset("The voice engine got stuck; restarting it.", false);
      }, HANG_MS);
      this.pending.set(id, { resolve, reject, started: performance.now(), timer });
      this.worker!.postMessage({ type: "generate", id, text, voice } satisfies PiperRequest);
    });
  }
}

export const piper = new PiperClient();
