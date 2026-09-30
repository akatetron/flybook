// Plays a book sentence by sentence. With studio voices it generates a few
// sentences ahead in the background so playback is continuous; with system
// voices it hands each sentence to the phone's speech engine.
import type { Chapter, Segment } from "../lib/text";
import { speakable } from "../lib/text";
import type { Engine } from "../lib/settings";
import { kokoro, type Clip } from "./kokoro";
import { findSystemVoice } from "./system";

export interface NarratorState {
  index: number;
  playing: boolean;
  buffering: boolean;
  finished: boolean;
  error: string | null;
  sleep: { until: number } | { chapterEnd: true } | null;
}

export interface NarratorOptions {
  title: string;
  cover: string | null;
  segments: Segment[];
  chapters: Chapter[];
  start: number;
  engine: Engine;
  studioVoice: string;
  systemVoice: string | null;
  speed: number;
  onPosition: (index: number) => void;
}

/** How many sentences to generate ahead of the one playing. */
const LOOKAHEAD = 4;

// A tiny silent WAV, played synchronously inside the first tap so iOS lets
// the same <audio> element play later without another tap.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export class Narrator {
  private opts: NarratorOptions;
  private audio = new Audio();
  private state: NarratorState;
  private listeners = new Set<() => void>();

  /** Bumped whenever what should be playing changes; stale async work checks it. */
  private token = 0;
  /** Bumped when the voice changes; clips from an old voice are discarded. */
  private voiceGen = 0;
  private cache = new Map<number, Clip | null>();
  private inflight: number | null = null;
  private waiters = new Map<number, ((clip: Clip | null) => void)[]>();
  private loadedIndex = -1;
  private switchingSrc = false;
  private unlocked = false;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: NarratorOptions) {
    this.opts = opts;
    const start = Math.min(Math.max(0, opts.start), Math.max(0, opts.segments.length - 1));
    this.state = { index: start, playing: false, buffering: false, finished: false, error: null, sleep: null };
    this.audio.preload = "auto";
    this.audio.addEventListener("ended", () => {
      if (this.state.playing) this.advance();
    });
    this.audio.addEventListener("pause", () => {
      // Paused by the OS (headphones unplugged, phone call, lock-screen button).
      setTimeout(() => {
        if (!this.switchingSrc && this.audio.paused && !this.audio.ended && this.state.playing && !this.state.buffering && this.opts.engine === "studio") {
          this.token++;
          this.emit({ playing: false });
        }
      }, 0);
    });
    this.setupMediaSession();
  }

  // ---------- subscription (for React's useSyncExternalStore) ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getState = () => this.state;

  private emit(patch: Partial<NarratorState>) {
    const prevIndex = this.state.index;
    this.state = { ...this.state, ...patch };
    if (patch.index !== undefined && patch.index !== prevIndex) {
      this.opts.onPosition(patch.index);
      this.updateMediaMetadata();
    }
    this.listeners.forEach((fn) => fn());
  }

  // ---------- public controls ----------

  play() {
    if (this.opts.segments.length === 0) return;
    if (this.opts.engine === "studio" && !this.unlocked) {
      this.unlocked = true;
      this.switchingSrc = true;
      this.audio.src = SILENCE;
      this.audio.play().catch(() => undefined).finally(() => (this.switchingSrc = false));
    }
    const restart = this.state.finished;
    this.emit({ playing: true, error: null, finished: false, ...(restart ? { index: 0 } : {}) });
    if (
      this.opts.engine === "studio" &&
      this.loadedIndex === this.state.index &&
      this.audio.src.startsWith("blob:") &&
      !this.audio.ended
    ) {
      this.audio.play().catch(() => this.emit({ playing: false }));
      return;
    }
    this.playCurrent();
  }

  pause() {
    this.token++;
    this.emit({ playing: false, buffering: false });
    this.audio.pause();
    if (this.opts.engine === "system") {
      speechSynthesis.cancel();
      this.loadedIndex = -1;
    }
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(index: number) {
    const i = Math.min(Math.max(0, index), this.opts.segments.length - 1);
    this.emit({ index: i, finished: false });
    if (this.state.playing) this.playCurrent();
    else {
      this.loadedIndex = -1;
      this.audio.pause();
      this.pump();
    }
  }

  next() {
    this.seek(this.state.index + 1);
  }

  prev() {
    this.seek(this.state.index - 1);
  }

  setSpeed(speed: number) {
    this.opts.speed = speed;
    this.audio.playbackRate = speed;
    if (this.opts.engine === "system" && this.state.playing) this.playCurrent();
  }

  setVoice(engine: Engine, studioVoice: string, systemVoice: string | null) {
    const changed =
      engine !== this.opts.engine || studioVoice !== this.opts.studioVoice || systemVoice !== this.opts.systemVoice;
    if (!changed) return;
    if (this.opts.engine === "system") speechSynthesis.cancel();
    this.audio.pause();
    this.opts = { ...this.opts, engine, studioVoice, systemVoice };
    this.clearCache();
    if (this.state.playing) this.playCurrent();
  }

  setSleep(sleep: NarratorState["sleep"]) {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (sleep && "until" in sleep) {
      this.sleepTimer = setTimeout(() => {
        this.pause();
        this.emit({ sleep: null });
      }, sleep.until - Date.now());
    }
    this.emit({ sleep });
  }

  destroy() {
    this.pause();
    this.clearCache();
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.audio.removeAttribute("src");
    this.audio.load();
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    this.listeners.clear();
  }

  // ---------- playback ----------

  private async playCurrent() {
    const token = ++this.token;
    const index = this.state.index;
    const segment = this.opts.segments[index];
    if (!segment) return;

    if (this.opts.engine === "system") {
      this.speakSystem(index, token);
      return;
    }

    let clip = this.cache.get(index);
    if (clip === undefined) {
      this.emit({ buffering: true });
      this.pump();
      clip = await this.waitFor(index);
      if (token !== this.token) return;
    }
    this.emit({ buffering: false });
    if (clip === null) {
      if (this.state.error) this.emit({ playing: false });
      else this.advance();
      return;
    }

    this.switchingSrc = true;
    this.audio.src = clip.url;
    this.audio.playbackRate = this.opts.speed;
    this.loadedIndex = index;
    try {
      await this.audio.play();
    } catch (err) {
      if (token === this.token && (err as Error).name === "NotAllowedError") this.emit({ playing: false });
    } finally {
      this.switchingSrc = false;
    }
    this.pump();
  }

  private speakSystem(index: number, token: number) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speakable(this.opts.segments[index]));
    const voice = findSystemVoice(this.opts.systemVoice);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = this.opts.speed;
    utterance.onend = () => {
      if (token === this.token && this.state.playing) this.advance();
    };
    utterance.onerror = (e) => {
      if (token !== this.token || e.error === "interrupted" || e.error === "canceled") return;
      this.emit({ playing: false, error: "The phone's speech engine stopped. Tap play to continue." });
    };
    this.loadedIndex = index;
    this.emit({ buffering: false });
    speechSynthesis.speak(utterance);
  }

  private advance() {
    const nextIndex = this.state.index + 1;
    if (nextIndex >= this.opts.segments.length) {
      this.token++;
      this.emit({ playing: false, finished: true });
      return;
    }
    const sleep = this.state.sleep;
    if (sleep && "chapterEnd" in sleep && this.opts.chapters.some((c) => c.start === nextIndex)) {
      this.emit({ index: nextIndex, sleep: null });
      this.pause();
      return;
    }
    this.emit({ index: nextIndex });
    this.playCurrent();
  }

  // ---------- studio voice buffering ----------

  private waitFor(index: number): Promise<Clip | null> {
    return new Promise((resolve) => {
      const list = this.waiters.get(index) ?? [];
      list.push(resolve);
      this.waiters.set(index, list);
    });
  }

  /** Generates the next missing sentence in the look-ahead window. */
  private pump() {
    if (this.opts.engine !== "studio" || this.inflight !== null) return;
    const { index } = this.state;
    const last = Math.min(this.opts.segments.length - 1, index + LOOKAHEAD);
    let target = -1;
    for (let i = index; i <= last; i++) {
      if (!this.cache.has(i)) {
        target = i;
        break;
      }
    }
    this.evict();
    if (target === -1) return;

    const gen = this.voiceGen;
    this.inflight = target;
    kokoro
      .generate(speakable(this.opts.segments[target]), this.opts.studioVoice)
      .then((clip) => {
        if (gen !== this.voiceGen) {
          URL.revokeObjectURL(clip.url);
          return;
        }
        this.store(target, clip);
      })
      .catch((err: Error) => {
        if (gen !== this.voiceGen) return;
        if (kokoro.current.phase === "error") {
          // The engine itself failed to load — stop and tell the user.
          this.emit({ error: err.message });
          this.waiters.forEach((list) => list.forEach((fn) => fn(null)));
          this.waiters.clear();
          return;
        }
        // One odd sentence failed: skip it rather than stopping the book.
        this.store(target, null);
      })
      .finally(() => {
        if (gen === this.voiceGen) {
          this.inflight = null;
          if (!this.state.error) this.pump();
        }
      });
  }

  private store(index: number, clip: Clip | null) {
    this.cache.set(index, clip);
    const list = this.waiters.get(index);
    this.waiters.delete(index);
    list?.forEach((fn) => fn(clip));
  }

  private evict() {
    const { index } = this.state;
    for (const [i, clip] of this.cache) {
      if (i < index - 2 || i > index + LOOKAHEAD + 6) {
        if (clip && i !== this.loadedIndex) URL.revokeObjectURL(clip.url);
        this.cache.delete(i);
      }
    }
  }

  private clearCache() {
    this.voiceGen++;
    this.inflight = null;
    this.loadedIndex = -1;
    for (const clip of this.cache.values()) if (clip) URL.revokeObjectURL(clip.url);
    this.cache.clear();
    this.waiters.forEach((list) => list.forEach((fn) => fn(null)));
    this.waiters.clear();
  }

  // ---------- lock screen / headphone controls ----------

  private chapterTitle(index: number): string {
    let title = "";
    for (const c of this.opts.chapters) if (c.start <= index) title = c.title;
    return title;
  }

  private updateMediaMetadata() {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.chapterTitle(this.state.index) || this.opts.title,
      artist: this.opts.title,
      album: "Flybook",
      artwork: this.opts.cover ? [{ src: this.opts.cover, sizes: "240x320", type: "image/jpeg" }] : [],
    });
  }

  private setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    this.updateMediaMetadata();
    const handlers: [MediaSessionAction, () => void][] = [
      ["play", () => this.play()],
      ["pause", () => this.pause()],
      ["previoustrack", () => this.prev()],
      ["nexttrack", () => this.next()],
      ["seekbackward", () => this.prev()],
      ["seekforward", () => this.next()],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* action not supported on this browser */
      }
    }
  }
}
