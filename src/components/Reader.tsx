import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getBook, updateBook, type BookContent, type BookMeta } from "../lib/db";
import type { Settings } from "../lib/settings";
import { Narrator, type NarratorState } from "../tts/narrator";
import { kokoro } from "../tts/kokoro";
import { STUDIO_VOICES, studioVoice } from "../tts/voices";
import { findSystemVoice } from "../tts/system";
import { WORDS_PER_MINUTE, formatDuration } from "../lib/format";
import { Sheet } from "./Sheet";
import { ModelDownloadCard, VoiceSheet, formatMB, useModelState } from "./VoiceSheet";
import { BackIcon, CheckIcon, ListIcon, MicIcon, MoonIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, TextSizeIcon } from "./Icons";

interface ReaderProps {
  bookId: string;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const WINDOW_BEFORE = 120;
const WINDOW_AFTER = 300;
const WINDOW_STEP = 250;

export function Reader({ bookId, settings, onSettings, onBack }: ReaderProps) {
  const [book, setBook] = useState<{ meta: BookMeta; content: BookContent } | null | undefined>(undefined);

  useEffect(() => {
    getBook(bookId).then((b) => {
      setBook(b);
      if (b) updateBook(bookId, { openedAt: Date.now() });
    });
  }, [bookId]);

  if (book === undefined) return <div className="center muted">Opening…</div>;
  if (book === null)
    return (
      <div className="center">
        <p className="muted">This book isn't on this device any more.</p>
        <button className="btn" onClick={onBack}>
          Back to library
        </button>
      </div>
    );
  return <ReaderView meta={book.meta} content={book.content} settings={settings} onSettings={onSettings} onBack={onBack} />;
}

function ReaderView({
  meta,
  content,
  settings,
  onSettings,
  onBack,
}: { meta: BookMeta; content: BookContent } & Omit<ReaderProps, "bookId">) {
  const { segments, chapters } = content;

  // ---------- narrator ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPosition = useRef(meta.position);
  const savePosition = useCallback(
    (index: number) => {
      lastPosition.current = index;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => updateBook(meta.id, { position: index }), 800);
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
  useEffect(
    () => narrator.setVoice(settings.engine, settings.studioVoice, settings.systemVoice),
    [narrator, settings.engine, settings.studioVoice, settings.systemVoice]
  );

  const state = useSyncExternalStore(narrator.subscribe, narrator.getState);
  const model = useModelState();
  const { index } = state;

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
      !kokoro.wasDownloaded()
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

  function onTextClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!target) return;
    const i = Number(target.dataset.i);
    setFollow(true);
    narrator.seek(i);
    if (!state.playing) togglePlay();
  }

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
      if (sheet || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") narrator.next();
      else if (e.code === "ArrowLeft") narrator.prev();
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
                {p.items.map((i) => (
                  <span key={i} data-i={i} className={i === index ? "seg cur" : "seg"}>
                    {segments[i].t}{" "}
                  </span>
                ))}
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
          <span className="voice-kind">{settings.engine === "studio" ? "Studio" : "iPhone / phone"} voice</span>
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

      <Sheet title="Studio voices" open={sheet === "model"} onClose={closeSheet}>
        <p>
          Flybook's studio voices sound like a real narrator and run entirely on your phone — nothing is uploaded.
        </p>
        <p className="muted small">
          They need a one-time download of {kokoro.downloadLabel} (Wi-Fi recommended). After that they work offline.
        </p>
        <div className="stack">
          <button
            className="btn primary"
            onClick={() => {
              kokoro.load().catch(() => undefined);
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
        {settings.engine === "studio" && <ModelDownloadCard />}
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
  const model = useModelState();
  const info = kokoro.info;
  const rtf = kokoro.realTimeFactor;
  const pct = Math.min(100, (state.ahead / PREP_TARGET_SECONDS) * 100);
  let activity: string;
  if (model.phase === "loading") activity = "Starting the voice engine…";
  else if (state.preparing) activity = state.playing ? "Preparing the next sentences…" : "Preparing while paused…";
  else if (state.chapterReady >= 0.999) activity = "Chapter ready";
  else activity = "Ready";
  const engine = info
    ? `${info.device === "webgpu" ? "GPU" : `CPU · ${info.threads} ${info.threads === 1 ? "core" : "cores"}`}${
        rtf ? ` · ${(1 / rtf).toFixed(1)}× speed` : ""
      }`
    : "";
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
  title,
  start,
  page,
  minutes,
  current,
  studio,
  onPlay,
}: {
  narrator: Narrator;
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
              {STUDIO_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.gender === "Female" ? "F" : "M"}, {v.accent === "British" ? "UK" : "US"})
                </option>
              ))}
            </select>
          </label>
          {done ? (
            <span className="ch-state ready">
              <CheckIcon width={14} height={14} /> Ready
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

