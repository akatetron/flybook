import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  deleteAnnotation,
  getBook,
  listAnnotations,
  newId,
  saveAnnotation,
  saveContent,
  updateBook,
  type Annotation,
  type BookContent,
  type BookMeta,
  type HighlightColor,
} from "../lib/db";
import { COLORS, bySentence, makeAnnotation } from "../lib/annotations";
import { deleteSentenceAudio, loadClips } from "../lib/audioStore";
import { joinWavs } from "../lib/wav";
import { formatBytes } from "../lib/storage";
import type { Settings } from "../lib/settings";
import { Narrator, type NarratorState } from "../tts/narrator";
import { tts } from "../tts/engines";
import { STUDIO_VOICES, studioVoice } from "../tts/voices";
import { findSystemVoice } from "../tts/system";
import { WORDS_PER_MINUTE, formatDuration } from "../lib/format";
import { Sheet } from "./Sheet";
import { ModelDownloadCard, VoiceSheet, formatMB, useModelState } from "./VoiceSheet";
import { BackIcon, CheckIcon, ListIcon, MicIcon, MoonIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, TextSizeIcon } from "./Icons";

interface ReaderProps {
  bookId: string;
  /** Sentence to open at (e.g. from a saved note), instead of the saved position. */
  startAt?: number | null;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const WINDOW_BEFORE = 120;
const WINDOW_AFTER = 300;
const WINDOW_STEP = 250;

export function Reader({ bookId, startAt, settings, onSettings, onBack }: ReaderProps) {
  const [book, setBook] = useState<{ meta: BookMeta; content: BookContent } | null | undefined>(undefined);
  const [docVoice, setDocVoice] = useState<string | undefined>(undefined);

  useEffect(() => {
    getBook(bookId).then((b) => {
      if (b && startAt != null && startAt >= 0 && startAt < b.content.segments.length) {
        b = { ...b, meta: { ...b.meta, position: startAt } };
      }
      setBook(b);
      setDocVoice(b?.meta.voice && STUDIO_VOICES.some((v) => v.id === b!.meta.voice) ? b.meta.voice : undefined);
      if (b) updateBook(bookId, { openedAt: Date.now() });
    });
  }, [bookId, startAt]);

  // Each document remembers its own voice; choosing one also makes it the default for new documents.
  const effective = docVoice ? { ...settings, studioVoice: docVoice } : settings;
  const onEffective = useCallback(
    (patch: Partial<Settings>) => {
      if (patch.studioVoice) {
        setDocVoice(patch.studioVoice);
        void updateBook(bookId, { voice: patch.studioVoice });
      }
      onSettings(patch);
    },
    [bookId, onSettings]
  );

  if (book === undefined) return <div className="center muted">Opening…</div>;
  if (book === null)
    return (
      <div className="center">
        <p className="muted">This document isn't on this device any more.</p>
        <button className="btn" onClick={onBack}>
          Back to library
        </button>
      </div>
    );
  return (
    <ReaderView
      key={startAt ?? "saved"}
      meta={book.meta}
      content={book.content}
      settings={effective}
      onSettings={onEffective}
      onBack={onBack}
      resumed={startAt == null && book.meta.position > 0}
    />
  );
}

function ReaderView({
  meta,
  content,
  settings,
  onSettings,
  onBack,
  resumed,
}: { meta: BookMeta; content: BookContent; resumed: boolean } & Omit<ReaderProps, "bookId" | "startAt">) {
  const [segments, setSegments] = useState(content.segments);
  const { chapters } = content;

  // ---------- narrator ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPosition = useRef(meta.position);
  const savePosition = useCallback(
    (index: number) => {
      lastPosition.current = index;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => updateBook(meta.id, { position: index, positionAt: Date.now() }), 800);
    },
    [meta.id]
  );

  const narrator = useMemo(
    () =>
      new Narrator({
        bookId: meta.id,
        title: meta.title,
        cover: meta.cover,
        segments,
        chapters,
        start: meta.position,
        engine: settings.engine,
        studioVoice: settings.studioVoice,
        systemVoice: settings.systemVoice,
        speed: settings.speed,
        skipCitations: settings.skipCitations,
        skipReferences: settings.skipReferences,
        onPosition: savePosition,
      }),
    // Settings changes are pushed into the live narrator below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.id]
  );

  useEffect(() => {
    const flush = () => updateBook(meta.id, { position: lastPosition.current });
    window.addEventListener("pagehide", flush);
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
      narrator.destroy();
    };
  }, [narrator, meta.id]);

  useEffect(() => narrator.setSpeed(settings.speed), [narrator, settings.speed]);
  useEffect(() => narrator.setNarration(settings.skipCitations, settings.skipReferences), [narrator, settings.skipCitations, settings.skipReferences]);
  useEffect(
    () => narrator.setVoice(settings.engine, settings.studioVoice, settings.systemVoice),
    [narrator, settings.engine, settings.studioVoice, settings.systemVoice]
  );

  const state = useSyncExternalStore(narrator.subscribe, narrator.getState);
  const { index } = state;
  const currentVoice = narrator.voiceAt(index);
  const model = useModelState(currentVoice);

  // ---------- derived numbers ----------
  const wordsBefore = useMemo(() => {
    const acc = new Uint32Array(segments.length + 1);
    segments.forEach((s, i) => (acc[i + 1] = acc[i] + s.t.split(/\s+/).length));
    return acc;
  }, [segments]);
  const totalWords = wordsBefore[segments.length];
  const minutesLeft = (totalWords - wordsBefore[index]) / (WORDS_PER_MINUTE * settings.speed);
  const percent = totalWords ? Math.floor((wordsBefore[index] / totalWords) * 100) : 0;
  const chapterIndex = useMemo(() => {
    let c = 0;
    chapters.forEach((ch, i) => ch.start <= index && (c = i));
    return c;
  }, [chapters, index]);

  // ---------- sheets ----------
  const [sheet, setSheet] = useState<null | "voice" | "chapters" | "speed" | "sleep" | "text" | "model">(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const [view, setView] = useState<"listen" | "read">("listen");

  function togglePlay() {
    if (
      !state.playing &&
      settings.engine === "studio" &&
      model.phase !== "ready" &&
      model.phase !== "loading" &&
      !tts.wasDownloaded(currentVoice)
    ) {
      setSheet("model");
      return;
    }
    narrator.toggle();
  }

  function usePhoneVoice() {
    const voice = findSystemVoice(settings.systemVoice);
    narrator.setVoice("system", settings.studioVoice, voice?.voiceURI ?? null);
    onSettings({ engine: "system", systemVoice: voice?.voiceURI ?? null });
    narrator.play();
    setSheet(null);
  }

  // ---------- text window & follow-along scrolling ----------
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [win, setWin] = useState(() => ({
    from: Math.max(0, meta.position - WINDOW_BEFORE),
    to: Math.min(segments.length, meta.position + WINDOW_AFTER),
  }));
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    if (index < win.from || index >= win.to) {
      setWin({ from: Math.max(0, index - WINDOW_BEFORE), to: Math.min(segments.length, index + WINDOW_AFTER) });
    } else if (index > win.to - 40) {
      setWin((w) => ({ ...w, to: Math.min(segments.length, w.to + WINDOW_STEP) }));
    }
  }, [index, win.from, win.to, segments.length]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    }
  }, [win.from]);

  const topSentinel = useRef<HTMLDivElement>(null);
  const bottomSentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (e.target === topSentinel.current) {
            setWin((w) => {
              if (w.from === 0) return w;
              anchor.current = root.scrollHeight - root.scrollTop;
              return { ...w, from: Math.max(0, w.from - WINDOW_STEP) };
            });
          } else {
            setWin((w) => (w.to >= segments.length ? w : { ...w, to: Math.min(segments.length, w.to + WINDOW_STEP) }));
          }
        }
      },
      { root, rootMargin: "600px 0px" }
    );
    if (topSentinel.current) io.observe(topSentinel.current);
    if (bottomSentinel.current) io.observe(bottomSentinel.current);
    return () => io.disconnect();
  }, [segments.length]);

  const scrollToCurrent = useCallback((smooth: boolean) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-i="${narrator.getState().index}"]`);
    el?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  }, [narrator]);

  useLayoutEffect(() => {
    scrollToCurrent(false);
    // Only on first render: land on the saved position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (follow && view === "read") scrollToCurrent(true);
  }, [index, follow, win.from, scrollToCurrent, view]);

  useLayoutEffect(() => {
    if (view === "read") {
      setFollow(true);
      scrollToCurrent(false);
    }
  }, [view, scrollToCurrent]);

  const stopFollowing = () => setFollow(false);

  // ---------- annotations ----------
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => {
    listAnnotations(meta.id).then(setAnnotations, () => setAnnotations([]));
  }, [meta.id]);
  const marks = useMemo(() => bySentence(annotations), [annotations]);
  /** Sentences picked in the text: tap one, tap another to extend. */
  const [selection, setSelection] = useState<{ start: number; end: number; anchor: number } | null>(null);
  const [editor, setEditor] = useState<null | { kind: "note"; annotation: Annotation | null } | { kind: "correct"; index: number }>(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function addAnnotation(kind: Annotation["kind"], start: number, end: number, extra: { color?: HighlightColor | null; note?: string } = {}) {
    const a = makeAnnotation(meta.id, segments, kind, start, end, { ...extra, id: newId(), now: Date.now() });
    try {
      await saveAnnotation(a);
      setAnnotations((list) => [...list, a]);
      return a;
    } catch {
      setToast("Couldn't save — your browser's storage may be full.");
      return null;
    }
  }

  async function removeAnnotation(a: Annotation) {
    await deleteAnnotation(a.id);
    setAnnotations((list) => list.filter((x) => x.id !== a.id));
  }

  /** The highlight exactly covering the selection, if any. */
  const selectedHighlight = selection
    ? annotations.find((a) => a.kind === "highlight" && a.start === selection.start && a.end === selection.end) ?? null
    : null;
  const selectedNote = selection
    ? annotations.find((a) => a.kind === "note" && a.start === selection.start && a.end === selection.end) ?? null
    : null;
  const bookmarkAt = (i: number) => annotations.find((a) => a.kind === "bookmark" && a.start === i) ?? null;

  async function toggleBookmark(i: number) {
    const existing = bookmarkAt(i);
    if (existing) {
      await removeAnnotation(existing);
      setToast("Bookmark removed");
    } else if (await addAnnotation("bookmark", i, i)) setToast(`Bookmarked p. ${segments[i]?.p ?? 1}`);
  }

  async function highlight(color: HighlightColor) {
    if (!selection) return;
    if (selectedHighlight) {
      const updated = { ...selectedHighlight, color, updatedAt: Date.now() };
      await saveAnnotation(updated);
      setAnnotations((list) => list.map((a) => (a.id === updated.id ? updated : a)));
    } else await addAnnotation("highlight", selection.start, selection.end, { color });
    setSelection(null);
  }

  function openNote() {
    if (!selection) return;
    setDraft(selectedNote?.note ?? "");
    setEditor({ kind: "note", annotation: selectedNote });
  }

  async function saveNote() {
    if (!editor || editor.kind !== "note" || !selection) return;
    const text = draft.trim();
    if (editor.annotation) {
      if (!text) await removeAnnotation(editor.annotation);
      else {
        const updated = { ...editor.annotation, note: text, updatedAt: Date.now() };
        await saveAnnotation(updated);
        setAnnotations((list) => list.map((a) => (a.id === updated.id ? updated : a)));
      }
    } else if (text) await addAnnotation("note", selection.start, selection.end, { note: text });
    setEditor(null);
    setSelection(null);
  }

  /** Corrects what is spoken for one sentence; the extracted text is kept. */
  async function saveCorrection() {
    if (!editor || editor.kind !== "correct") return;
    const i = editor.index;
    const text = draft.replace(/\s+/g, " ").trim();
    const seg = segments[i];
    if (!seg || !text || text === seg.t) return setEditor(null);
    // The narrator reads the same array, so the change applies to playback too.
    segments[i] = { ...seg, t: text, o: seg.o ?? seg.t };
    setSegments([...segments]);
    try {
      await saveContent({ id: meta.id, segments, chapters });
      await deleteSentenceAudio(meta.id, i);
      narrator.invalidate(i);
      setToast("Correction saved for this document");
    } catch {
      setToast("Couldn't save the correction.");
    }
    setEditor(null);
    setSelection(null);
  }

  function onTextClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!target) return;
    const i = Number(target.dataset.i);
    setSelection((sel) => {
      if (!sel) return { start: i, end: i, anchor: i };
      if (sel.start === i && sel.end === i) return null;
      // Extend from where the selection started (up to a long paragraph's worth).
      const start = Math.max(Math.min(sel.anchor, i), Math.max(sel.anchor, i) - 40);
      return { start, end: Math.max(sel.anchor, i), anchor: sel.anchor };
    });
  }

  function playFromSelection() {
    if (!selection) return;
    setFollow(true);
    narrator.seek(selection.start);
    if (!state.playing) togglePlay();
    setSelection(null);
  }

  useEffect(() => {
    let notice: string | null = null;
    try {
      notice = sessionStorage.getItem(`flybook:notice:${meta.id}`);
      sessionStorage.removeItem(`flybook:notice:${meta.id}`);
    } catch {
      /* ignore */
    }
    if (notice) setToast(notice);
    else if (resumed) setToast(`Resumed at p. ${segments[meta.position]?.p ?? 1}`);
    // Once, when the document opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paragraph grouping for the visible window.
  const paragraphs = useMemo(() => {
    const out: { heading: boolean; items: number[] }[] = [];
    for (let i = win.from; i < win.to; i++) {
      const s = segments[i];
      if (s.b || out.length === 0) out.push({ heading: !!s.h, items: [i] });
      else out[out.length - 1].items.push(i);
    }
    return out;
  }, [segments, win.from, win.to]);

  // ---------- scrubber ----------
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? index;
  const commitScrub = () => {
    if (scrub !== null) {
      setFollow(true);
      narrator.seek(scrub);
      setScrub(null);
    }
  };

  // ---------- keyboard (desktop) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (sheet || editor || tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") narrator.next();
      else if (e.code === "ArrowLeft") narrator.prev();
      else if (e.key === "]" && chapters[chapterIndex + 1]) narrator.seek(chapters[chapterIndex + 1].start);
      else if (e.key === "[") narrator.seek(chapters[chapterIndex]?.start === index && chapterIndex > 0 ? chapters[chapterIndex - 1].start : (chapters[chapterIndex]?.start ?? 0));
      else if (e.key === "b") void toggleBookmark(index);
      else if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- status line ----------
  let status: React.ReactNode = null;
  if (state.error) {
    status = (
      <span className="status error">
        {state.error}{" "}
        <button className="link" onClick={usePhoneVoice}>
          Use phone voice
        </button>
      </span>
    );
  } else if (settings.engine === "studio" && model.phase === "loading" && (state.playing || state.buffering)) {
    status = (
      <span className="status">
        {model.total && model.loaded < model.total
          ? `Downloading voices · ${formatMB(model.loaded)} of ${formatMB(model.total)}`
          : "Starting voice engine…"}
      </span>
    );
  } else if (state.buffering) {
    status = (
      <span className="status">
        Preparing audio… {state.ahead > 0 ? `${Math.round(state.ahead)}s ready` : ""}
      </span>
    );
  } else if (state.finished) {
    status = <span className="status">The end. Tap play to listen again.</span>;
  } else if (state.sleep) {
    status = (
      <span className="status">
        {"until" in state.sleep ? <SleepCountdown until={state.sleep.until} /> : "Sleeping at end of chapter"}
      </span>
    );
  } else if (settings.engine === "studio" && (state.ahead >= 1 || state.chapterReady > 0)) {
    status =
      view === "read" ? (
        <span className="status quiet">
          {formatAhead(state.ahead)} prepared ahead{state.preparing ? " · preparing…" : ""}
        </span>
      ) : null;
  }

  const voiceLabel =
    settings.engine === "studio"
      ? studioVoice(narrator.chapterVoice(chapters[chapterIndex]?.start ?? 0)).name
      : findSystemVoice(settings.systemVoice)?.name ?? "Phone voice";

  const chapterTitle = chapters[chapterIndex]?.title;
  const current = segments[index]?.t ?? "";
  const upcoming = segments[index + 1]?.t ?? "";

  return (
    <div className={`reader view-${view}`} style={{ ["--text-size" as string]: `${settings.textSize}px` }}>
      <header className="reader-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to library">
          <BackIcon />
        </button>
        <div className="segmented view-switch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "listen"} className={view === "listen" ? "on" : ""} onClick={() => setView("listen")}>
            Listen
          </button>
          <button role="tab" aria-selected={view === "read"} className={view === "read" ? "on" : ""} onClick={() => setView("read")}>
            Read
          </button>
        </div>
        {view === "read" ? (
          <button className="icon-btn" onClick={() => setSheet("text")} aria-label="Text size">
            <TextSizeIcon />
          </button>
        ) : (
          <span className="icon-btn spacer" aria-hidden />
        )}
        <button className="icon-btn" onClick={() => setSheet("chapters")} aria-label="Chapters">
          <ListIcon />
        </button>
      </header>

      {view === "listen" && (
        <main className={`listen ${settings.engine === "studio" && state.slow && !state.error ? "has-hint" : ""}`}>
          <div className="np-art">
            {meta.cover ? <img src={meta.cover} alt="" /> : <span className="np-art-fallback">{meta.title}</span>}
          </div>
          <div className="np-meta">
            <h1 className="np-title">{meta.title}</h1>
            {chapterTitle && (
              <button className="np-chapter" onClick={() => setSheet("chapters")}>
                {chapterTitle}
              </button>
            )}
          </div>
          <button className="np-caption" onClick={() => setView("read")} aria-label="Open the text">
            <span className="np-now">{current}</span>
            {upcoming && <span className="np-next">{upcoming}</span>}
          </button>
          {settings.engine === "studio" && (
            <PrepPanel
              state={state}
              narrator={narrator}
              nextChapter={chapters[chapterIndex + 1] ?? null}
              onOpenChapters={() => setSheet("chapters")}
            />
          )}
          {settings.engine === "studio" && state.slow && !state.error && (
            <div className="np-hint">
              <p>
                This phone makes the studio voice slower than it plays. Pause for a minute to let it get ahead, or pick
                an iPhone voice for instant playback.
              </p>
              <button className="link" onClick={() => setSheet("voice")}>
                Choose voice
              </button>
            </div>
          )}
        </main>
      )}

      <div
        className="reading"
        ref={scroller}
        hidden={view !== "read"}
        onTouchMove={stopFollowing}
        onWheel={stopFollowing}
        onClick={onTextClick}
      >
        <div ref={topSentinel} className="sentinel" />
        <article className="page">
          {paragraphs.map((p) => {
            const Tag = p.heading ? "h3" : "p";
            return (
              <Tag key={p.items[0]}>
                {p.items.map((i) => {
                  const m = marks.get(i);
                  const hl = m?.find((a) => a.kind === "highlight");
                  const cls = [
                    "seg",
                    i === index && "cur",
                    hl && `hl hl-${hl.color ?? "amber"}`,
                    m?.some((a) => a.kind === "note") && "has-note",
                    m?.some((a) => a.kind === "bookmark") && "has-bookmark",
                    selection && i >= selection.start && i <= selection.end && "sel",
                    segments[i].o !== undefined && "corrected",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <span key={i} data-i={i} className={cls}>
                      {segments[i].t}{" "}
                    </span>
                  );
                })}
              </Tag>
            );
          })}
          {win.to >= segments.length && <p className="end-mark">— End —</p>}
        </article>
        <div ref={bottomSentinel} className="sentinel" />
      </div>

      {view === "read" && !follow && (
        <button
          className="follow-pill"
          onClick={() => {
            setFollow(true);
            scrollToCurrent(true);
          }}
        >
          Back to current sentence
        </button>
      )}

      {view === "read" && selection && (
        <div className="selection-bar" role="toolbar" aria-label="Selected passage">
          <span className="selection-info">
            {selection.end > selection.start ? `${selection.end - selection.start + 1} sentences` : "1 sentence"} · p.{" "}
            {segments[selection.start]?.p ?? 1}
            <span className="muted"> · tap another sentence to extend</span>
          </span>
          <div className="selection-actions">
            <button className="btn small primary" onClick={playFromSelection}>
              <PlayIcon width={14} height={14} /> Play from here
            </button>
            <span className="swatches" role="group" aria-label="Highlight colour">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`swatch swatch-${c.id} ${selectedHighlight?.color === c.id ? "on" : ""}`}
                  onClick={() => highlight(c.id)}
                  aria-label={`Highlight ${c.label}`}
                  aria-pressed={selectedHighlight?.color === c.id}
                />
              ))}
            </span>
            {selectedHighlight && (
              <button className="btn small" onClick={() => removeAnnotation(selectedHighlight).then(() => setSelection(null))}>
                Remove highlight
              </button>
            )}
            <button className="btn small" onClick={openNote}>
              {selectedNote ? "Edit note" : "Note"}
            </button>
            <button className="btn small" onClick={() => toggleBookmark(selection.start).then(() => setSelection(null))}>
              {bookmarkAt(selection.start) ? "Remove bookmark" : "Bookmark"}
            </button>
            {selection.start === selection.end && (
              <button
                className="btn small"
                onClick={() => {
                  setDraft(segments[selection.start].t);
                  setEditor({ kind: "correct", index: selection.start });
                }}
              >
                Correct text
              </button>
            )}
            <button className="icon-btn small" onClick={() => setSelection(null)} aria-label="Clear selection">
              ×
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
          {resumed && toast.startsWith("Resumed") && (
            <button
              className="link"
              onClick={() => {
                narrator.seek(0);
                setToast(null);
              }}
            >
              Start from the beginning
            </button>
          )}
        </div>
      )}

      <Sheet title={editor?.kind === "correct" ? "Correct spoken text" : "Note"} open={!!editor} onClose={() => setEditor(null)}>
        {editor?.kind === "correct" ? (
          <p className="muted small">
            Fix what the voice says for this sentence in this document only. The original PDF isn't changed
            {segments[editor.index]?.o !== undefined ? "; the extracted text was: “" + segments[editor.index].o + "”" : ""}.
          </p>
        ) : (
          <blockquote className="note-quote">
            {selection ? segments.slice(selection.start, selection.end + 1).map((x) => x.t).join(" ") : ""}
          </blockquote>
        )}
        <textarea
          className="note-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={editor?.kind === "correct" ? 4 : 5}
          autoFocus
          aria-label={editor?.kind === "correct" ? "Spoken text" : "Note"}
          placeholder={editor?.kind === "note" ? "Your note — kept on this device" : undefined}
        />
        <div className="stack">
          <button className="btn primary" onClick={editor?.kind === "correct" ? saveCorrection : saveNote}>
            Save
          </button>
          {editor?.kind === "correct" && segments[editor.index]?.o !== undefined && (
            <button className="btn" onClick={() => setDraft(segments[editor.index].o!)}>
              Restore extracted text
            </button>
          )}
        </div>
      </Sheet>

      <footer className="player">
        <div className="scrub">
          <input
            type="range"
            min={0}
            max={Math.max(0, segments.length - 1)}
            value={shown}
            aria-label="Position in book"
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={commitScrub}
            onTouchEnd={commitScrub}
            onKeyUp={commitScrub}
            style={{ ["--pct" as string]: `${(shown / Math.max(1, segments.length - 1)) * 100}%` }}
          />
          <div className="scrub-labels">
            <span>
              p. {segments[shown]?.p ?? 1}/{meta.pageCount} · {percent}%
            </span>
            <span>{formatDuration(minutesLeft)} left</span>
          </div>
        </div>

        <div className="status-row">{status}</div>

        <div className="controls">
          <button className="ctl-side" onClick={() => setSheet("speed")} aria-label="Playback speed">
            <span className="ctl-speed">{settings.speed}×</span>
          </button>
          <button className="icon-btn big" onClick={() => narrator.prev()} aria-label="Previous sentence">
            <PrevIcon />
          </button>
          <PlayButton playing={state.playing} busy={state.playing && state.buffering} onClick={togglePlay} />
          <button className="icon-btn big" onClick={() => narrator.next()} aria-label="Next sentence">
            <NextIcon />
          </button>
          <button
            className={`ctl-side ${state.sleep ? "active" : ""}`}
            onClick={() => setSheet("sleep")}
            aria-label="Sleep timer"
          >
            <MoonIcon width={20} height={20} />
          </button>
        </div>

        <button className="voice-chip" onClick={() => setSheet("voice")}>
          <MicIcon width={15} height={15} /> {voiceLabel}
          <span className="voice-kind">{settings.engine === "studio" ? tts.engineName(currentVoice) : "Phone voice"}</span>
        </button>
      </footer>

      <VoiceSheet
        open={sheet === "voice"}
        onClose={closeSheet}
        settings={{ ...settings, studioVoice: narrator.chapterVoice(chapters[chapterIndex]?.start ?? 0) }}
        onChange={(patch) => {
          // Picking a voice here applies to the chapter being listened to right away.
          const start = chapters[chapterIndex]?.start ?? 0;
          if (patch.studioVoice && narrator.hasOwnVoice(start)) narrator.setChapterVoice(start, null);
          onSettings(patch);
        }}
        onBeforePreview={() => narrator.pause()}
      />

      <Sheet title={`${studioVoice(currentVoice).name} voice`} open={sheet === "model"} onClose={closeSheet}>
        <p>This voice runs entirely on your device — nothing is uploaded.</p>
        <p className="muted small">
          It needs a one-time download of {tts.downloadLabel(currentVoice)} (Wi-Fi recommended). After that it works
          offline.
        </p>
        <div className="stack">
          <button
            className="btn primary"
            onClick={() => {
              tts.load(currentVoice).catch(() => undefined);
              narrator.play();
              setSheet(null);
            }}
          >
            Download and play
          </button>
          <button className="btn" onClick={usePhoneVoice}>
            Use my phone's voice instead
          </button>
        </div>
      </Sheet>

      <Sheet title="Chapters" open={sheet === "chapters"} onClose={closeSheet}>
        {settings.engine === "studio" ? (
          <p className="muted small hint">
            Tap <strong>Prepare</strong> to get a chapter ready ahead of time — listen to one while the next is being
            prepared. Each chapter can have its own voice.
          </p>
        ) : (
          <p className="muted small hint">Preparing chapters and per-chapter voices are available with studio voices.</p>
        )}
        <ul className="chapter-list">
          {chapters.map((c, i) => (
            <ChapterRow
              key={`${c.start}-${i}`}
              narrator={narrator}
              bookId={meta.id}
              end={chapters[i + 1]?.start ?? segments.length}
              version={state.version}
              title={c.title}
              start={c.start}
              page={segments[c.start]?.p ?? 1}
              minutes={
                (wordsBefore[chapters[i + 1]?.start ?? segments.length] - wordsBefore[c.start]) /
                (WORDS_PER_MINUTE * settings.speed)
              }
              current={i === chapterIndex}
              studio={settings.engine === "studio"}
              onPlay={() => {
                setFollow(true);
                narrator.seek(c.start);
                setSheet(null);
              }}
            />
          ))}
        </ul>
      </Sheet>

      <Sheet title="Speed" open={sheet === "speed"} onClose={closeSheet}>
        <div className="chip-grid">
          {SPEEDS.map((s) => (
            <button key={s} className={`chip ${settings.speed === s ? "active" : ""}`} onClick={() => onSettings({ speed: s })}>
              {s}×
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet title="Sleep timer" open={sheet === "sleep"} onClose={closeSheet}>
        <div className="chip-grid">
          {[5, 15, 30, 45, 60].map((m) => (
            <button
              key={m}
              className="chip"
              onClick={() => {
                narrator.setSleep({ until: Date.now() + m * 60_000 });
                setSheet(null);
              }}
            >
              {m} min
            </button>
          ))}
          <button
            className={`chip ${state.sleep && "chapterEnd" in state.sleep ? "active" : ""}`}
            onClick={() => {
              narrator.setSleep({ chapterEnd: true });
              setSheet(null);
            }}
          >
            End of chapter
          </button>
          {state.sleep && (
            <button
              className="chip"
              onClick={() => {
                narrator.setSleep(null);
                setSheet(null);
              }}
            >
              Off
            </button>
          )}
        </div>
      </Sheet>

      <Sheet title="Text" open={sheet === "text"} onClose={closeSheet}>
        <label className="size-row">
          <span style={{ fontSize: 14 }}>A</span>
          <input
            type="range"
            min={15}
            max={28}
            value={settings.textSize}
            onChange={(e) => onSettings({ textSize: Number(e.target.value) })}
            aria-label="Text size"
          />
          <span style={{ fontSize: 26 }}>A</span>
        </label>
        {settings.engine === "studio" && <ModelDownloadCard voice={currentVoice} />}
      </Sheet>
    </div>
  );
}

function PlayButton({ playing, busy, onClick }: { playing: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button className={`play ${busy ? "busy" : ""}`} onClick={onClick} aria-label={playing ? "Pause" : "Play"}>
      {busy && <span className="play-spin" aria-hidden />}
      <span className="play-core">
        {playing ? <PauseIcon width={30} height={30} /> : <PlayIcon width={30} height={30} />}
      </span>
    </button>
  );
}

function SleepCountdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <>Sleeping in {Math.max(1, Math.ceil((until - now) / 60_000))} min</>;
}

function formatAhead(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60}s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Ten minutes prepared ahead fills the bar. */
const PREP_TARGET_SECONDS = 600;

/** How much audio is ready ahead, and what the voice engine is doing. */
function PrepPanel({
  state,
  narrator,
  nextChapter,
  onOpenChapters,
}: {
  state: NarratorState;
  narrator: Narrator;
  nextChapter: { title: string; start: number } | null;
  onOpenChapters: () => void;
}) {
  const voice = narrator.voiceAt(state.index);
  const model = useModelState(voice);
  const label = tts.label(voice);
  const rtf = tts.realTimeFactor(voice);
  const pct = Math.min(100, (state.ahead / PREP_TARGET_SECONDS) * 100);
  let activity: string;
  if (model.phase === "loading")
    activity = model.total && model.loaded < model.total ? `Downloading voice · ${formatMB(model.loaded)} of ${formatMB(model.total)}` : "Starting the voice…";
  else if (state.preparing) activity = state.playing ? "Preparing the next sentences…" : "Preparing while paused…";
  else if (state.chapterReady >= 0.999) activity = "Chapter ready";
  else activity = "Ready";
  const engine = label ? `${label}${rtf ? ` · ${(1 / rtf).toFixed(1)}× speed` : ""}` : "";
  return (
    <div className="prep" aria-live="polite">
      <div className="prep-row">
        <span>Prepared ahead</span>
        <strong>{formatAhead(state.ahead)}</strong>
      </div>
      <div className="bar thin">
        <div className={`bar-fill ${state.preparing ? "pulse" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="prep-row muted small">
        <span>{activity}</span>
        <span>{engine}</span>
      </div>
      {nextChapter && <NextChapterPrep narrator={narrator} chapter={nextChapter} onOpenChapters={onOpenChapters} />}
    </div>
  );
}

function ChapterRow({
  narrator,
  bookId,
  end,
  title,
  start,
  page,
  minutes,
  current,
  studio,
  onPlay,
}: {
  narrator: Narrator;
  bookId: string;
  end: number;
  version: number;
  title: string;
  start: number;
  page: number;
  minutes: number;
  current: boolean;
  studio: boolean;
  onPlay: () => void;
}) {
  const voice = narrator.chapterVoice(start);
  const p = narrator.chapterProgress(start);
  const pct = p.total ? Math.floor((p.ready / p.total) * 100) : 0;
  const done = p.total > 0 && p.ready >= p.total;
  const [exporting, setExporting] = useState<{ done: number; total: number; abort: AbortController } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  /** Saves the prepared chapter as one WAV file (made on this device from the saved sentences). */
  async function exportAudio() {
    const abort = new AbortController();
    setExportError(null);
    setExporting({ done: 0, total: end - start, abort });
    try {
      const clips = await loadClips(bookId, voice, start, end);
      const missing = clips.findIndex((c) => !c);
      if (missing >= 0) throw new Error(`Sentence ${start + missing + 1} isn't prepared in this voice yet.`);
      const { blob } = await joinWavs(clips as Blob[], {
        signal: abort.signal,
        onProgress: (d, t) => setExporting((x) => (x ? { ...x, done: d, total: t } : x)),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "chapter"}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setExportError(`Saved ${formatBytes(blob.size)} WAV`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setExportError((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <li className={`ch ${current ? "current" : ""}`}>
      <button className="ch-main" onClick={onPlay}>
        <span className="ch-title">{title}</span>
        <span className="muted small">
          p. {page} · {formatDuration(minutes)}
          {current ? " · now playing" : ""}
        </span>
      </button>
      {studio && (
        <div className="ch-tools">
          <label className="ch-voice">
            <MicIcon width={14} height={14} />
            <select
              value={voice}
              aria-label={`Voice for ${title}`}
              onChange={(e) => narrator.setChapterVoice(start, e.target.value)}
            >
              {(["piper", "kokoro"] as const).map((engine) => (
                <optgroup key={engine} label={engine === "piper" ? "Natural (fast)" : "Studio (best on computers)"}>
                  {STUDIO_VOICES.filter((v) => v.engine === engine).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender === "Female" ? "F" : "M"}, {v.accent === "British" ? "UK" : "US"})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {done ? (
            <span className="ch-state ready">
              <CheckIcon width={14} height={14} /> Ready
              {exporting ? (
                <button className="ch-prepare" onClick={() => exporting.abort.abort()}>
                  Exporting {Math.round((exporting.done / Math.max(1, exporting.total)) * 100)}% · Cancel
                </button>
              ) : (
                <button className="ch-prepare" onClick={exportAudio} title="Save this chapter as a WAV audio file">
                  Export WAV
                </button>
              )}
              {exportError && <span className="muted tiny">{exportError}</span>}
            </span>
          ) : p.queued ? (
            <span className="ch-state">
              <span className="ch-bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              {formatDuration(p.readySeconds / 60)} ready
              <button className="ch-cancel" onClick={() => narrator.cancelPrepare(start)} aria-label="Stop preparing">
                ✕
              </button>
            </span>
          ) : (
            <button className="ch-prepare" onClick={() => narrator.prepareChapter(start)}>
              {p.ready > 0 ? `Prepare (${formatDuration(p.readySeconds / 60)} ready)` : "Prepare"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function NextChapterPrep({
  narrator,
  chapter,
  onOpenChapters,
}: {
  narrator: Narrator;
  chapter: { title: string; start: number };
  onOpenChapters: () => void;
}) {
  const p = narrator.chapterProgress(chapter.start);
  const voice = studioVoice(narrator.chapterVoice(chapter.start)).name;
  return (
    <div className="prep-next">
      <span className="title-line">
        Next: {chapter.title} · {voice}
      </span>
      {p.ready >= p.total ? (
        <span className="ch-state ready">
          <CheckIcon width={14} height={14} /> Ready
        </span>
      ) : p.queued ? (
        <span className="ch-state">{formatDuration(p.readySeconds / 60)} ready</span>
      ) : (
        <button className="ch-prepare" onClick={() => narrator.prepareChapter(chapter.start)}>
          Prepare
        </button>
      )}
      <button className="link small" onClick={onOpenChapters}>
        All
      </button>
    </div>
  );
}

