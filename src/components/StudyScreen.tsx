import { useEffect, useMemo, useState } from "react";
import {
  deleteAnnotation,
  getBook,
  listAnnotations,
  listBooks,
  saveAnnotation,
  type Annotation,
  type AnnotationKind,
  type BookMeta,
  type HighlightColor,
} from "../lib/db";
import { COLORS, download, filterAnnotations, locate, toCSV, toJSON, toMarkdown } from "../lib/annotations";

const KINDS: { id: AnnotationKind; label: string }[] = [
  { id: "highlight", label: "Highlights" },
  { id: "note", label: "Notes" },
  { id: "bookmark", label: "Bookmarks" },
];

const DATES = [
  { id: "all", label: "Any time", ms: 0 },
  { id: "week", label: "Past week", ms: 7 * 864e5 },
  { id: "month", label: "Past month", ms: 30 * 864e5 },
];

export function StudyScreen({ onOpen }: { onOpen: (id: string, at?: number) => void }) {
  const [items, setItems] = useState<Annotation[] | null>(null);
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [query, setQuery] = useState("");
  const [bookId, setBookId] = useState<string>("");
  const [kind, setKind] = useState<AnnotationKind | "">("");
  const [color, setColor] = useState<HighlightColor | "">("");
  const [date, setDate] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listAnnotations(), listBooks()]).then(
      ([a, b]) => {
        setItems(a);
        setBooks(b);
      },
      () => setItems([])
    );
  }, []);

  const titles = useMemo(() => new Map(books.map((b) => [b.id, b.title])), [books]);
  const since = DATES.find((d) => d.id === date)!.ms;
  const shown = useMemo(
    () =>
      filterAnnotations(items ?? [], {
        query,
        bookId: bookId || null,
        kind: kind || null,
        color: color || null,
        since: since ? Date.now() - since : null,
      }),
    [items, query, bookId, kind, color, since]
  );

  async function jump(a: Annotation) {
    const book = await getBook(a.bookId);
    if (!book) return setMessage("That document isn't on this device any more.");
    const found = locate(a, book.content.segments);
    if (!found) setMessage("The passage's text has changed; opening at its original place.");
    onOpen(a.bookId, found?.start ?? Math.min(a.start, book.content.segments.length - 1));
  }

  async function saveEdit(a: Annotation) {
    const updated = { ...a, note: draft.trim(), updatedAt: Date.now() };
    await saveAnnotation(updated);
    setItems((list) => list?.map((x) => (x.id === a.id ? updated : x)) ?? null);
    setEditing(null);
  }

  async function remove(a: Annotation) {
    if (!confirm("Delete this " + (a.kind === "bookmark" ? "bookmark" : a.kind) + "?")) return;
    await deleteAnnotation(a.id);
    setItems((list) => list?.filter((x) => x.id !== a.id) ?? null);
  }

  function exportAs(format: "md" | "json" | "csv") {
    const exportBooks = books.map((b) => ({ id: b.id, title: b.title }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "md") download(`flybook-notes-${stamp}.md`, toMarkdown(shown, exportBooks), "text/markdown");
    else if (format === "json") download(`flybook-notes-${stamp}.json`, toJSON(shown, exportBooks), "application/json");
    else download(`flybook-notes-${stamp}.csv`, toCSV(shown, exportBooks), "text/csv");
  }

  return (
    <div className="screen study">
      <header className="screen-head">
        <h1>Study</h1>
        <p className="muted">Highlights, notes and bookmarks from all your documents. Kept on this device only.</p>
      </header>

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <h2>Nothing saved yet</h2>
          <p className="muted">
            Open a document, switch to <strong>Read</strong>, and tap a sentence to highlight it, add a note or bookmark it.
            Tap a second sentence to select a longer passage.
          </p>
        </div>
      ) : (
        <>
          <div className="filters">
            <input
              type="search"
              className="search"
              placeholder="Search quotes and notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search quotes and notes"
            />
            <select value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Document">
              <option value="">All documents</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as AnnotationKind | "")} aria-label="Type">
              <option value="">All types</option>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <select value={color} onChange={(e) => setColor(e.target.value as HighlightColor | "")} aria-label="Colour">
              <option value="">Any colour</option>
              {COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date">
              {DATES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="export-row">
            <span className="muted small">
              {shown.length} of {items.length}
            </span>
            <span className="export-buttons">
              Export:
              <button className="btn small" onClick={() => exportAs("md")} disabled={!shown.length}>
                Markdown
              </button>
              <button className="btn small" onClick={() => exportAs("json")} disabled={!shown.length}>
                JSON
              </button>
              <button className="btn small" onClick={() => exportAs("csv")} disabled={!shown.length}>
                CSV
              </button>
            </span>
          </div>
          {message && (
            <p className="alert" role="status">
              {message}
            </p>
          )}

          <ul className="annotation-list">
            {shown.map((a) => (
              <li key={a.id} className={`annotation kind-${a.kind}`}>
                <div className="annotation-meta">
                  <span className={`dot ${a.color ? `swatch-${a.color}` : ""}`} aria-hidden />
                  <span className="annotation-kind">{a.kind === "highlight" ? "Highlight" : a.kind === "note" ? "Note" : "Bookmark"}</span>
                  <span className="muted small">
                    {titles.get(a.bookId) ?? "Removed document"} · {a.page ? `p. ${a.page}` : `sentence ${a.start + 1}`} ·{" "}
                    {new Date(a.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <button className="annotation-quote" onClick={() => jump(a)} title="Open at this passage">
                  {a.quote}
                </button>
                {editing === a.id ? (
                  <div className="annotation-edit">
                    <textarea className="note-input" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Note" autoFocus />
                    <button className="btn small primary" onClick={() => saveEdit(a)}>
                      Save
                    </button>
                    <button className="btn small" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  a.note && <p className="annotation-note">{a.note}</p>
                )}
                <div className="annotation-actions">
                  <button className="link" onClick={() => jump(a)}>
                    Go to passage
                  </button>
                  <button
                    className="link"
                    onClick={() => {
                      setDraft(a.note);
                      setEditing(a.id);
                    }}
                  >
                    {a.note ? "Edit note" : "Add note"}
                  </button>
                  <button className="link danger" onClick={() => remove(a)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
