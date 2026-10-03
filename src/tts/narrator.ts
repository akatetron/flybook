// Plays a book sentence by sentence.
//
// Studio voices: every generated sentence is saved on the device, and while
// the book is open the rest of the current chapter keeps being prepared in
// the background (also while paused). Playback reads from what's prepared, so
// once a stretch is ready it never stops to buffer, and replaying or reopening
// a book is instant. System voices hand each sentence to the phone's speech
// engine.
import type { Chapter, Segment } from "../lib/text";
import { speakable } from "../lib/text";
import type { Engine } from "../lib/settings";
import { loadClip, saveClip, savedLengths } from "../lib/audioStore";
import { kokoro, type Clip } from "./kokoro";
import { findSystemVoice } from "./system";

export interface NarratorState {
  index: number;
  playing: boolean;
  buffering: boolean;
  /** Seconds of audio ready ahead of the current position (studio voices). */
  ahead: number;
  /** Share of the current chapter that's prepared, 0–1 (studio voices). */
  chapterReady: number;
  /** This device makes speech slower than it plays. */
  slow: boolean;
  finished: boolean;
  error: string | null;
  sleep: { until: number } | { chapterEnd: true } | null;
}

export interface NarratorOptions {
  bookId: string;
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

/** Sentences kept decoded in memory around the listener. */
const MEMORY_WINDOW = 12;
/** Always prepare at least this many sentences ahead, even past a chapter end. */
const MIN_PREPARE = 60;

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
  /** Bumped when the voice changes; work for an old voice is discarded. */
  private voiceGen = 0;
  /** Playable audio in memory, by sentence index (null = sentence failed, skip it). */
  private cache = new Map<number, Clip | null>();
  /** Seconds of each sentence saved on the device for the current voice. */
  private saved = new Map<number, number>();
  private savedReady = false;
  private busy = false;
  private waiters = new Map<number, (() => void)[]>();
  private loadedIndex = -1;
  private switchingSrc = false;
  private unlocked = false;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: NarratorOptions) {
    this.opts = opts;
    const start = Math.min(Math.max(0, opts.start), Math.max(0, opts.segments.length - 1));
    this.state = {
      index: start,
      playing: false,
      buffering: false,
      ahead: 0,
      chapterReady: 0,
      slow: false,
      finished: false,
      error: null,
      sleep: null,
    };
    this.audio.preload = "auto";
    this.audio.addEventListener("ended", () => {
      if (this.state.playing) this.advance();
    });
    this.audio.addEventListener("pause", () => {
      // Paused by the OS (headphones unplugged, phone call, lock-screen button).
      setTimeout(() => {
        if (
          !this.switchingSrc &&
          this.audio.paused &&
          !this.audio.ended &&
          this.state.playing &&
          !this.state.buffering &&
          this.opts.engine === "studio"
        ) {
          this.token++;
          this.emit({ playing: false });
        }
      }, 0);
    });
    this.setupMediaSession();
    this.loadSaved();
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
      this.audio
        .play()
        .catch(() => undefined)
        .finally(() => (this.switchingSrc = false));
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
    this.notify();
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
    const voiceChanged = studioVoice !== this.opts.studioVoice;
    this.opts = { ...this.opts, engine, studioVoice, systemVoice };
    this.clearMemory();
    if (voiceChanged) this.loadSaved();
    if (this.state.playing) this.playCurrent();
    else this.pump();
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
    this.clearMemory();
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.audio.removeAttribute("src");
    this.audio.load();
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    this.listeners.clear();
  }

  // ---------- playback ----------

  private async playCurrent() {
    const token = ++this.token;
    this.notify(); // lets waits from the previous position finish
    const index = this.state.index;
    if (!this.opts.segments[index]) return;

    if (this.opts.engine === "system") {
      this.speakSystem(index, token);
      return;
    }

    if (!this.cache.has(index)) {
      this.emit({ buffering: true });
      this.pump();
      await this.waitUntil(token, () => this.cache.has(index) || !!this.state.error);
      if (token !== this.token) return;
      // Ran dry (not just loading saved audio): build a cushion sized to how
      // fast this device is, so playback then runs on without stopping.
      if (!this.saved.has(index)) {
        const cushion = this.cushionSeconds();
        await this.waitUntil(token, () => {
          const r = this.readyAhead(index);
          return r.seconds >= cushion || r.end >= this.opts.segments.length || !!this.state.error;
        });
        if (token !== this.token) return;
        await this.waitUntil(token, () => this.cache.has(index) || !!this.state.error);
        if (token !== this.token) return;
      }
    }
    this.emit({ buffering: false });
    const clip = this.cache.get(index);
    if (!clip) {
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

  // ---------- studio voice: preparing audio ----------

  /** Resolves once `ready()` is true (re-checked whenever new audio is
   *  ready), or as soon as playback moves on (`token` is stale). */
  private waitUntil(token: number, ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (token !== this.token || ready()) resolve();
        else this.onProgress(check);
      };
      this.onProgress(check);
    });
  }

  private onProgress(fn: () => void) {
    const list = this.waiters.get(0) ?? [];
    list.push(fn);
    this.waiters.set(0, list);
  }

  private notify() {
    const list = this.waiters.get(0) ?? [];
    this.waiters.delete(0);
    list.forEach((fn) => fn());
  }

  /** How much audio to have ready before resuming after running dry. */
  private cushionSeconds(): number {
    const rtf = kokoro.realTimeFactor;
    if (rtf === null) return 8;
    if (rtf <= 0.85) return 4;
    // Slower than real time: a bigger cushion buys a longer stretch of
    // uninterrupted listening per wait.
    return Math.min(90, 20 * rtf);
  }

  private isReady(i: number) {
    return this.cache.has(i) || this.saved.has(i);
  }

  private secondsOf(i: number) {
    return this.cache.get(i)?.seconds ?? this.saved.get(i) ?? 0;
  }

  /** Seconds of contiguous ready audio from `from`, and the first index not ready. */
  private readyAhead(from: number): { seconds: number; end: number } {
    let seconds = 0;
    let i = from;
    while (i < this.opts.segments.length && this.isReady(i)) {
      seconds += this.secondsOf(i);
      i++;
    }
    return { seconds, end: i };
  }

  /** The chapter around `index` as [start, end). */
  private chapterBounds(index: number): [number, number] {
    let start = 0;
    let end = this.opts.segments.length;
    for (const c of this.opts.chapters) {
      if (c.start <= index) start = c.start;
      else {
        end = c.start;
        break;
      }
    }
    return [start, end];
  }

  /** Generating needs the voice model; never start its download unasked. */
  private canGenerate() {
    return kokoro.wasDownloaded() || kokoro.current.phase !== "idle" || this.state.playing;
  }

  private async loadSaved() {
    const gen = this.voiceGen;
    this.savedReady = false;
    this.saved = new Map();
    const lengths = await savedLengths(this.opts.bookId, this.opts.studioVoice);
    if (gen !== this.voiceGen) return;
    this.saved = lengths;
    this.savedReady = true;
    this.pump();
  }

  /** Does the next piece of work: load saved audio into memory, or generate. */
  private pump() {
    if (this.opts.engine !== "studio" || this.busy || !this.savedReady || this.state.error) return;
    const { index } = this.state;
    const n = this.opts.segments.length;
    this.evict();
    this.report();

    // 1. Sentences about to play: get them into memory (from saved audio when possible).
    for (let i = index; i < Math.min(n, index + MEMORY_WINDOW); i++) {
      if (this.cache.has(i)) continue;
      if (this.saved.has(i)) return void this.run(() => this.loadFromSaved(i));
      if (!this.canGenerate()) return;
      return void this.run(() => this.generate(i, true));
    }

    // 2. Background: prepare the rest of this chapter (at least MIN_PREPARE ahead).
    if (!this.canGenerate()) return;
    const [, chapterEnd] = this.chapterBounds(index);
    const until = Math.min(n, Math.max(chapterEnd, index + MIN_PREPARE));
    for (let i = index; i < until; i++) {
      if (!this.isReady(i)) return void this.run(() => this.generate(i, false));
    }
  }

  private run(job: () => Promise<void>) {
    const gen = this.voiceGen;
    this.busy = true;
    job()
      .catch(() => undefined)
      .finally(() => {
        if (gen !== this.voiceGen) return;
        this.busy = false;
        this.notify();
        this.pump();
      });
  }

  private async loadFromSaved(i: number) {
    const gen = this.voiceGen;
    const blob = await loadClip(this.opts.bookId, this.opts.studioVoice, i);
    if (gen !== this.voiceGen) return;
    if (!blob) {
      this.saved.delete(i); // was cleaned up to free space; generate it again
      return;
    }
    this.cache.set(i, { url: URL.createObjectURL(blob), blob, seconds: this.saved.get(i) ?? 0 });
  }

  private async generate(i: number, keepInMemory: boolean) {
    const gen = this.voiceGen;
    const voice = this.opts.studioVoice;
    try {
      const clip = await kokoro.generate(speakable(this.opts.segments[i]), voice);
      if (gen !== this.voiceGen) {
        URL.revokeObjectURL(clip.url);
        return;
      }
      this.saved.set(i, clip.seconds);
      void saveClip(this.opts.bookId, voice, i, clip.blob, clip.seconds);
      if (keepInMemory || Math.abs(i - this.state.index) < MEMORY_WINDOW) this.cache.set(i, clip);
      else URL.revokeObjectURL(clip.url);
      const rtf = kokoro.realTimeFactor;
      if (rtf !== null && rtf > 1.05 !== this.state.slow) this.emit({ slow: rtf > 1.05 });
    } catch (err) {
      if (gen !== this.voiceGen) return;
      if (kokoro.current.phase === "error") {
        // The engine itself failed: stop and tell the listener.
        this.emit({ error: (err as Error).message, buffering: false });
        this.notify();
        return;
      }
      // One odd sentence failed: skip it rather than stopping the book.
      this.cache.set(i, null);
    }
  }

  /** Publishes how much is prepared, for the UI. */
  private report() {
    const { index } = this.state;
    const ahead = this.readyAhead(index).seconds;
    const [start, end] = this.chapterBounds(index);
    let ready = 0;
    for (let i = start; i < end; i++) if (this.isReady(i)) ready++;
    const chapterReady = end > start ? ready / (end - start) : 1;
    if (Math.abs(ahead - this.state.ahead) >= 1 || Math.abs(chapterReady - this.state.chapterReady) >= 0.01) {
      this.emit({ ahead, chapterReady });
    }
  }

  private evict() {
    const { index } = this.state;
    for (const [i, clip] of this.cache) {
      if (i < index - 2 || i >= index + MEMORY_WINDOW + 4) {
        if (clip && i !== this.loadedIndex) URL.revokeObjectURL(clip.url);
        this.cache.delete(i);
      }
    }
  }

  private clearMemory() {
    this.voiceGen++;
    this.busy = false;
    this.loadedIndex = -1;
    for (const clip of this.cache.values()) if (clip) URL.revokeObjectURL(clip.url);
    this.cache.clear();
    this.notify();
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
