// Turns a book's sentences into audio files with a system voice, one at a
// time, starting from where the listener is. Finished clips are recorded in
// the database, so preparation resumes after the app is closed and never
// redoes work.
import { File } from "expo-file-system";
import { speakable, type Segment } from "../../shared/text";
import Native from "../modules/flybook-native";
import * as Kokoro from "./kokoro";
import { audioDir, freeBytes, listClips, saveClip, type Clip } from "./storage";

/** Keep this much space free for the rest of the phone. */
const MIN_FREE_BYTES = 300 * 1024 * 1024;
const SYSTEM_EXT = process.env.EXPO_OS === "ios" ? "caf" : "wav";

export type PrepState = "idle" | "working" | "done" | "paused" | "no-space" | "error";

export interface PrepStatus {
  bookId: string | null;
  state: PrepState;
  /** Clips ready for the current voice. */
  ready: number;
  total: number;
  message?: string;
}

interface Focus {
  bookId: string;
  segments: Segment[];
  voiceId: string;
  from: number;
}

type Listener = (status: PrepStatus) => void;

class Preparer {
  private focus: Focus | null = null;
  private clips = new Map<number, Clip>();
  private clipsFor: string | null = null;
  /** Sentences the voice can't read; skipped by the player. */
  private failed = new Set<number>();
  private running = false;
  private paused = false;
  private listeners = new Set<Listener>();
  private status: PrepStatus = { bookId: null, state: "idle", ready: 0, total: 0 };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<PrepStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn(this.status));
  }

  /** The clip for a sentence in the current voice, if it's ready. */
  clip(bookId: string, idx: number): Clip | "failed" | null {
    if (this.clipsFor !== bookId) return null;
    if (this.failed.has(idx)) return "failed";
    const c = this.clips.get(idx);
    return c && c.voiceId === this.focus?.voiceId ? c : null;
  }

  isReady(bookId: string, idx: number): boolean {
    return this.clip(bookId, idx) !== null;
  }

  /** Count of ready clips in [start, end). */
  readyIn(bookId: string, start: number, end: number): number {
    if (this.clipsFor !== bookId) return 0;
    let n = 0;
    for (let i = start; i < end; i++) if (this.isReady(bookId, i)) n++;
    return n;
  }

  /** Prepare `bookId` with `voiceId`, starting at sentence `from`. */
  async setFocus(bookId: string, segments: Segment[], voiceId: string, from: number) {
    const f = this.focus;
    if (f && f.bookId === bookId && f.voiceId === voiceId && f.from === from && f.segments === segments) {
      if (!this.paused) void this.run();
      return;
    }
    const changedBook = this.clipsFor !== bookId;
    const changedVoice = this.focus?.voiceId !== voiceId;
    this.focus = { bookId, segments, voiceId, from };
    if (changedBook) {
      this.clips = new Map((await listClips(bookId)).map((c) => [c.idx, c]));
      this.clipsFor = bookId;
    }
    if (changedBook || changedVoice) this.failed.clear();
    this.emit({ bookId, total: segments.length, ready: this.countReady() });
    this.paused = false;
    void this.run();
  }

  pause() {
    this.paused = true;
    if (this.status.state === "working") this.emit({ state: "paused" });
  }

  resume() {
    this.paused = false;
    void this.run();
  }

  private countReady(): number {
    const f = this.focus;
    if (!f) return 0;
    let n = 0;
    this.clips.forEach((c) => c.voiceId === f.voiceId && n++);
    return n;
  }

  /** Next sentence to prepare: the first missing one from the listener's place, then anything earlier. */
  private next(): number | null {
    const f = this.focus!;
    const missing = (i: number) => !this.failed.has(i) && this.clips.get(i)?.voiceId !== f.voiceId;
    for (let i = Math.max(0, f.from); i < f.segments.length; i++) if (missing(i)) return i;
    for (let i = 0; i < Math.min(f.from, f.segments.length); i++) if (missing(i)) return i;
    return null;
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.focus && !this.paused) {
        const f = this.focus;
        const idx = this.next();
        if (idx === null) {
          this.emit({ state: "done", ready: this.countReady() });
          return;
        }
        if (freeBytes() < MIN_FREE_BYTES) {
          this.emit({ state: "no-space", message: "Your phone is almost full. Free up space to keep preparing." });
          return;
        }
        this.emit({ state: "working" });
        const dir = audioDir(f.bookId);
        dir.create({ intermediates: true, idempotent: true });
        const studio = Kokoro.isStudio(f.voiceId);
        if (studio && !Kokoro.isInstalled()) {
          this.emit({ state: "error", message: "Download the studio voices to use this voice." });
          return;
        }
        // An older clip for this sentence in another voice (and maybe another format) is replaced.
        const old = this.clips.get(idx);
        if (old) {
          const stale = new File(old.file);
          if (stale.exists) stale.delete();
        }
        const file = new File(dir, `${idx}.${studio ? "wav" : SYSTEM_EXT}`);
        let clip: Clip | null = null;
        for (let attempt = 0; attempt < 2 && !clip; attempt++) {
          try {
            const text = speakable(f.segments[idx]);
            const { durationMs } = studio
              ? await Kokoro.render(text, f.voiceId, file.uri)
              : await Native.renderToFile(text, f.voiceId, 1, file.uri);
            clip = { idx, voiceId: f.voiceId, file: file.uri, durationMs };
          } catch (e) {
            if (attempt === 1) {
              // Voice gone (uninstalled) stops everything; anything else skips this sentence.
              if ((e as { code?: string }).code === "ERR_VOICE") {
                this.emit({ state: "error", message: (e as Error).message });
                return;
              }
              this.failed.add(idx);
            }
          }
        }
        // The focus may have moved to another book or voice while rendering.
        if (clip && this.focus?.bookId === f.bookId && this.focus.voiceId === f.voiceId) {
          await saveClip(f.bookId, clip);
          this.clips.set(idx, clip);
          this.emit({ ready: this.countReady() });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const preparer = new Preparer();
