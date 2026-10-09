// Plays a book's prepared sentence clips in order. If the next clip isn't
// ready yet, playback waits for the preparer instead of skipping ahead.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";
import type { Chapter, Segment } from "../../shared/text";
import { preparer } from "./preparer";
import { updateBook } from "./storage";

export interface PlayerState {
  bookId: string | null;
  index: number;
  /** The listener wants audio (it may be waiting for a clip). */
  playing: boolean;
  /** Playing was requested but the clip isn't prepared yet. */
  waiting: boolean;
  rate: number;
  sleepAt: number | null;
}

type Listener = (s: PlayerState) => void;

class Player {
  private audio: AudioPlayer | null = null;
  private segments: Segment[] = [];
  private chapters: Chapter[] = [];
  private title = "";
  private voiceId = "";
  private listeners = new Set<Listener>();
  private unsubscribePrep: (() => void) | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedIndex = -1;
  state: PlayerState = { bookId: null, index: 0, playing: false, waiting: false, rate: 1, sleepAt: null };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  private ensureAudio(): AudioPlayer {
    if (this.audio) return this.audio;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" });
    const audio = createAudioPlayer(null, { updateInterval: 250 });
    audio.addListener("playbackStatusUpdate", (s: AudioStatus) => this.onStatus(s));
    this.audio = audio;
    return audio;
  }

  private onStatus(s: AudioStatus) {
    if (s.didJustFinish) {
      if (this.state.playing) this.go(this.state.index + 1);
      return;
    }
    // Lock screen, headphones or an interruption paused or resumed the audio.
    if (s.isLoaded && !this.state.waiting && s.playing !== this.state.playing && this.loadedIndex === this.state.index) {
      this.set({ playing: s.playing });
    }
  }

  open(book: { id: string; title: string; position: number; rate: number }, segments: Segment[], chapters: Chapter[], voiceId: string) {
    if (this.state.bookId !== book.id) this.stopAudio();
    this.segments = segments;
    this.chapters = chapters;
    this.title = book.title;
    this.voiceId = voiceId;
    const index = Math.min(book.position, Math.max(0, segments.length - 1));
    this.set({ bookId: book.id, index, rate: book.rate, playing: this.state.bookId === book.id && this.state.playing });
    void preparer.setFocus(book.id, segments, voiceId, index);
    this.unsubscribePrep?.();
    this.unsubscribePrep = preparer.subscribe(() => {
      // A clip we were waiting for is ready.
      if (this.state.waiting && this.state.playing) this.go(this.state.index);
    });
  }

  setVoice(voiceId: string) {
    if (!this.state.bookId || voiceId === this.voiceId) return;
    this.voiceId = voiceId;
    const wasPlaying = this.state.playing;
    this.stopAudio();
    void preparer.setFocus(this.state.bookId, this.segments, voiceId, this.state.index);
    if (wasPlaying) this.play();
  }

  play() {
    this.set({ playing: true });
    this.go(this.state.index);
  }

  pause() {
    this.set({ playing: false, waiting: false });
    this.audio?.pause();
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(index: number) {
    const i = Math.max(0, Math.min(index, this.segments.length - 1));
    if (this.state.bookId) void preparer.setFocus(this.state.bookId, this.segments, this.voiceId, i);
    if (this.state.playing) this.go(i);
    else {
      this.loadedIndex = -1;
      this.set({ index: i });
      this.savePosition();
    }
  }

  setRate(rate: number) {
    this.set({ rate });
    this.audio?.setPlaybackRate(rate, "high");
    if (this.state.bookId) void updateBook(this.state.bookId, { rate });
  }

  /** Pause after `minutes`; null cancels. */
  sleep(minutes: number | null) {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (minutes === null) return this.set({ sleepAt: null });
    this.sleepTimer = setTimeout(() => {
      this.pause();
      this.set({ sleepAt: null });
    }, minutes * 60_000);
    this.set({ sleepAt: Date.now() + minutes * 60_000 });
  }

  chapterAt(index: number): Chapter | undefined {
    let found: Chapter | undefined;
    for (const c of this.chapters) if (c.start <= index) found = c;
    return found;
  }

  private go(index: number) {
    const bookId = this.state.bookId;
    if (!bookId) return;
    if (index >= this.segments.length) {
      this.set({ playing: false, waiting: false, index: this.segments.length - 1 });
      return;
    }
    // Skip sentences the voice couldn't read.
    let i = index;
    while (i < this.segments.length && preparer.clip(bookId, i) === "failed") i++;
    const clip = i < this.segments.length ? preparer.clip(bookId, i) : null;
    if (i !== this.state.index) {
      this.set({ index: i });
      this.savePosition();
    }
    if (!clip || clip === "failed") {
      this.audio?.pause();
      this.set({ waiting: i < this.segments.length });
      void preparer.setFocus(bookId, this.segments, this.voiceId, i);
      return;
    }
    const audio = this.ensureAudio();
    audio.replace({ uri: clip.file });
    this.loadedIndex = i;
    audio.setPlaybackRate(this.state.rate, "high");
    audio.play();
    audio.setActiveForLockScreen(
      true,
      { title: this.chapterAt(i)?.title ?? this.title, artist: this.title, albumTitle: "FlyBook" },
      { showSeekBackward: false, showSeekForward: false }
    );
    if (this.state.waiting) this.set({ waiting: false });
  }

  private stopAudio() {
    this.audio?.pause();
    this.loadedIndex = -1;
    this.set({ playing: false, waiting: false });
  }

  private savePosition() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const { bookId, index } = this.state;
    this.saveTimer = setTimeout(() => {
      if (bookId) void updateBook(bookId, { position: index });
    }, 1000);
  }
}

export const player = new Player();
