import { useCallback, useEffect, useRef, useState } from "react";
import { deleteBook, listBooks, newId, saveBook, type BookMeta } from "../lib/db";
import { LockIcon, MoreIcon, OfflineIcon, PlusIcon, WaveIcon } from "./Icons";
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

  const refresh = useCallback(() => {
    listBooks()
      .then(setBooks)
      .catch(() => setBooks([]));
  }, []);
  useEffect(refresh, [refresh]);

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
        },
        { id, segments: result.segments, chapters: result.chapters }
      );
      onOpen(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /password/i.test(message)
          ? "This PDF is password-protected. Remove the password and try again."
          : /invalid pdf|unexpected|corrupt/i.test(message)
            ? "This file couldn't be opened — it may be damaged."
            : message
      );
    } finally {
      setImporting(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(book: BookMeta) {
    setMenuFor(null);
    if (!confirm(`Remove “${book.title}” from this device?`)) return;
    await deleteBook(book.id);
    refresh();
  }

  const pct = importing?.total ? Math.round((importing.done / importing.total) * 100) : 0;

  return (
    <div className="library">
      <header className="lib-head">
        <div className="brand">
          <span className="logo" aria-hidden>
            <WaveIcon width={20} height={20} />
          </span>
          <h1>Flybook</h1>
        </div>
        <p className="muted">Turn any PDF into an audiobook — right on your phone.</p>
      </header>

      <label className="add-btn">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => onFile(e.target.files?.[0])}
          disabled={!!importing}
        />
        <PlusIcon /> Add a PDF
      </label>

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

      {books && books.length > 0 && (
        <ul className="book-list">
          {books.map((b) => {
            const progress = b.segmentCount > 1 ? b.position / (b.segmentCount - 1) : 0;
            const left = (b.words * (1 - progress)) / WORDS_PER_MINUTE;
            return (
              <li key={b.id} className="book">
                <button className="book-main" onClick={() => onOpen(b.id)}>
                  {b.cover ? (
                    <img className="cover" src={b.cover} alt="" />
                  ) : (
                    <span className="cover placeholder">{b.title.slice(0, 1)}</span>
                  )}
                  <span className="book-info">
                    <span className="book-title">{b.title}</span>
                    <span className="muted small">
                      {b.pageCount} pages · {progress > 0 ? `${formatDuration(left)} left` : formatDuration(b.words / WORDS_PER_MINUTE)}
                    </span>
                    <span className="bar thin">
                      <span className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </span>
                  </span>
                </button>
                <button className="icon-btn" aria-label={`Options for ${b.title}`} onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}>
                  <MoreIcon />
                </button>
                {menuFor === b.id && (
                  <div className="menu">
                    <button onClick={() => remove(b)}>Remove from device</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {books && books.length === 0 && !importing && (
        <ul className="features">
          <li>
            <LockIcon />
            <span>
              <strong>Private.</strong> Your PDFs never leave this device — no account, no uploads.
            </span>
          </li>
          <li>
            <WaveIcon />
            <span>
              <strong>Natural voices.</strong> Studio-quality narration generated on your phone, or use its built-in
              voices instantly.
            </span>
          </li>
          <li>
            <OfflineIcon />
            <span>
              <strong>Works offline.</strong> Picks up where you left off, with lock-screen controls and a sleep timer.
            </span>
          </li>
        </ul>
      )}

      {isIosBrowserTab() && books && books.length > 0 && (
        <p className="muted small tip">
          Tip: tap Share → “Add to Home Screen”. Safari may clear a website's saved books after a week without visits; a
          home-screen app keeps them.
        </p>
      )}
    </div>
  );
}
