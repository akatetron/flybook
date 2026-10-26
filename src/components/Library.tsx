import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteBook,
  listBooks,
  listCollections,
  newId,
  saveBook,
  saveCollection,
  saveFile,
  updateBook,
  type BookMeta,
  type Collection,
} from "../lib/db";
import { deleteBookAudio } from "../lib/audioStore";
import { LockIcon, MoreIcon, OfflineIcon, PlayIcon, PlusIcon, WaveIcon } from "./Icons";
import { WORDS_PER_MINUTE, formatDuration } from "../lib/format";

interface LibraryProps {
  onOpen: (id: string) => void;
}

function isIosBrowserTab(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  return ios && !standalone;
}

export function Library({ onOpen }: LibraryProps) {
  const [books, setBooks] = useState<BookMeta[] | null>(null);
  const [importing, setImporting] = useState<{ name: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [shelf, setShelf] = useState<string>("");
  const refresh = useCallback(() => {
    listBooks()
      .then(setBooks)
      .catch(() => setBooks([]));
    listCollections().then(setCollections, () => setCollections([]));
  }, []);

  async function newCollection() {
    const name = prompt("Name the collection (for example a matter, course or project):")?.trim();
    if (!name) return;
    const c = { id: newId(), name, createdAt: Date.now() };
    await saveCollection(c);
    setCollections((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name)));
    setShelf(c.id);
  }

  async function moveTo(book: BookMeta, collection: string) {
    setMenuFor(null);
    await updateBook(book.id, { collection: collection || null });
    refresh();
  }
  useEffect(refresh, [refresh]);

  async function addSample() {
    const { sampleBook, sampleCover } = await import("../lib/sample");
    const book = sampleBook();
    const id = newId();
    const now = Date.now();
    await saveBook(
      {
        id,
        title: book.title,
        fileName: "sample",
        pageCount: book.chapters.length,
        segmentCount: book.segments.length,
        words: book.words,
        cover: sampleCover(),
        addedAt: now,
        openedAt: now,
        position: 0,
      },
      { id, segments: book.segments, chapters: book.chapters }
    );
    onOpen(id);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("That file isn't a PDF.");
      return;
    }
    setImporting({ name: file.name, done: 0, total: 0 });
    try {
      // Loaded on demand so the library opens instantly.
      const { importPdf } = await import("../lib/pdf");
      const result = await importPdf(file, (done, total) => setImporting({ name: file.name, done, total }));
      if (result.segments.length === 0) throw new Error("No readable text found in this PDF.");
      const id = newId();
      const now = Date.now();
      await saveBook(
        {
          id,
          title: result.title,
          fileName: file.name,
          pageCount: result.pageCount,
          segmentCount: result.segments.length,
          words: result.words,
          cover: result.cover,
          addedAt: now,
          openedAt: now,
          position: 0,
          textQuality: result.kind === "text" ? "text" : "sparse",
        },
        { id, segments: result.segments, chapters: result.chapters }
      );
      // Keep the original PDF for page view; the book still works if this fails (e.g. storage full).
      try {
        await saveFile({ id, blob: file, name: file.name, type: file.type || "application/pdf" });
        await updateBook(id, { hasFile: true });
      } catch {
        /* text-only */
      }
      if (result.notice) {
        try {
          sessionStorage.setItem(`flybook:notice:${id}`, result.notice);
        } catch {
          /* ignore */
        }
      }
      onOpen(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "PasswordException" || /password/i.test(message)
          ? "This PDF is password-protected. Remove the password and try again."
          : name === "InvalidPDFException" || /invalid pdf|unexpected|corrupt/i.test(message)
            ? "This file couldn't be opened — it may be damaged or not really a PDF."
            : name === "QuotaExceededError"
              ? "There isn't enough storage space in this browser. Free some up in Storage and try again."
              : message
      );
    } finally {
      setImporting(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(book: BookMeta) {
    setMenuFor(null);
    if (!confirm(`Remove “${book.title}” from this device? Its text, original file, your place, highlights, notes, bookmarks and prepared audio are all deleted.`)) return;
    await Promise.all([deleteBook(book.id), deleteBookAudio(book.id)]);
    refresh();
  }

  const pct = importing?.total ? Math.round((importing.done / importing.total) * 100) : 0;
  const progressOf = (b: BookMeta) => (b.segmentCount > 1 ? b.position / (b.segmentCount - 1) : 0);
  const filePicker = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      onChange={(e) => onFile(e.target.files?.[0])}
      disabled={!!importing}
    />
  );
  const hasBooks = !!books && books.length > 0;
  const latest = hasBooks ? books![0] : null;

  return (
    <div className="library">
      <header className="lib-head">
        <div className="brand">
          <span className="logo" aria-hidden>
            <WaveIcon width={20} height={20} />
          </span>
          <h1>Flybook</h1>
        </div>
        {hasBooks && (
          <label className="add-round" aria-label="Add a PDF">
            {filePicker}
            <PlusIcon />
          </label>
        )}
      </header>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {importing && (
        <div className="card importing" aria-live="polite">
          <p className="title-line">{importing.name}</p>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">
            {importing.total ? `Reading page ${importing.done} of ${importing.total}` : "Opening…"}
          </p>
        </div>
      )}

      {books && books.length === 0 && !importing && (
        <section className="welcome">
          <h2>
            Turn any PDF into an <span className="grad-text">audiobook</span>.
          </h2>
          <p className="muted">Pick a PDF from your phone — it's read aloud with natural voices, right here.</p>
          <label className="drop">
            {filePicker}
            <span className="drop-icon">
              <PlusIcon />
            </span>
            <span className="drop-title">Add a PDF</span>
            <span className="muted small">From Files, iCloud Drive or Downloads</span>
          </label>
          <button className="sample-btn" onClick={addSample}>
            or try a short sample story
          </button>
          <ul className="features">
            <li>
              <LockIcon />
              <span>
                <strong>Private</strong>
                <span className="muted small">Nothing is uploaded. No account.</span>
              </span>
            </li>
            <li>
              <WaveIcon />
              <span>
                <strong>Natural voices</strong>
                <span className="muted small">Made on your phone, saved for offline.</span>
              </span>
            </li>
            <li>
              <OfflineIcon />
              <span>
                <strong>Picks up where you left off</strong>
                <span className="muted small">Lock-screen controls and a sleep timer.</span>
              </span>
            </li>
          </ul>
        </section>
      )}

      {latest && (
        <button className="hero" onClick={() => onOpen(latest.id)}>
          {latest.cover ? (
            <img className="cover" src={latest.cover} alt="" />
          ) : (
            <span className="cover placeholder">{latest.title.slice(0, 1)}</span>
          )}
          <span className="hero-info">
            <span className="eyebrow">Continue listening</span>
            <span className="hero-title">{latest.title}</span>
            <span className="muted small">
              {formatDuration((latest.words * (1 - progressOf(latest))) / WORDS_PER_MINUTE)} left
            </span>
            <span className="bar thin">
              <span className="bar-fill" style={{ width: `${Math.round(progressOf(latest) * 100)}%` }} />
            </span>
          </span>
          <span className="hero-play" aria-hidden>
            <PlayIcon width={24} height={24} />
          </span>
        </button>
      )}

      {hasBooks && (
        <>
          <div className="shelf-tabs" role="tablist" aria-label="Collections">
            <button role="tab" aria-selected={!shelf} className={`chip ${!shelf ? "active" : ""}`} onClick={() => setShelf("")}>
              All · {books!.length}
            </button>
            {collections.map((c) => (
              <button key={c.id} role="tab" aria-selected={shelf === c.id} className={`chip ${shelf === c.id ? "active" : ""}`} onClick={() => setShelf(c.id)}>
                {c.name} · {books!.filter((b) => b.collection === c.id).length}
              </button>
            ))}
            <button className="chip ghost" onClick={newCollection}>
              + Collection
            </button>
          </div>
          <ul className="shelf">
            {books!.filter((b) => !shelf || b.collection === shelf).map((b) => {
              const progress = progressOf(b);
              return (
                <li key={b.id} className="shelf-item">
                  <button className="shelf-main" onClick={() => onOpen(b.id)}>
                    <span className="shelf-cover">
                      {b.cover ? <img src={b.cover} alt="" /> : <span className="cover-fallback">{b.title}</span>}
                      <span className="shelf-progress">
                        <span style={{ width: `${Math.round(progress * 100)}%` }} />
                      </span>
                    </span>
                    <span className="shelf-title">{b.title}</span>
                    <span className="muted small">
                      {progress > 0.995
                        ? "Finished"
                        : progress > 0
                          ? `${Math.round(progress * 100)}% · ${formatDuration((b.words * (1 - progress)) / WORDS_PER_MINUTE)} left`
                          : formatDuration(b.words / WORDS_PER_MINUTE)}
                    </span>
                  </button>
                  <button
                    className="shelf-more"
                    aria-label={`Options for ${b.title}`}
                    onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}
                  >
                    <MoreIcon width={18} height={18} />
                  </button>
                  {menuFor === b.id && (
                    <div className="menu">
                      {collections.length > 0 && (
                        <label className="menu-select">
                          Collection
                          <select value={b.collection ?? ""} onChange={(e) => moveTo(b, e.target.value)}>
                            <option value="">None</option>
                            {collections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button onClick={() => remove(b)}>Remove from this device</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {isIosBrowserTab() && hasBooks && (
        <p className="muted small tip">
          Tip: tap Share → “Add to Home Screen”. Safari may clear a website's saved books after a week without visits; a
          home-screen app keeps them.
        </p>
      )}
    </div>
  );
}
