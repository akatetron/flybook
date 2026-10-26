// Pure helpers for highlights, notes and bookmarks: building anchors,
// finding them again, searching, and exporting with page references.
import type { Annotation, AnnotationKind, HighlightColor } from "./db";
import type { Segment } from "./text";

export const COLORS: { id: HighlightColor; label: string }[] = [
  { id: "amber", label: "Amber" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "rose", label: "Rose" },
];

export function makeAnnotation(
  bookId: string,
  segments: Segment[],
  kind: AnnotationKind,
  start: number,
  end: number,
  opts: { color?: HighlightColor | null; note?: string; id: string; now: number }
): Annotation {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.min(segments.length - 1, Math.max(start, end));
  return {
    id: opts.id,
    bookId,
    kind,
    start: s,
    end: e,
    page: segments[s]?.p ?? null,
    quote: segments
      .slice(s, e + 1)
      .map((x) => x.t)
      .join(" "),
    color: kind === "highlight" ? (opts.color ?? "amber") : (opts.color ?? null),
    note: opts.note ?? "",
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/**
 * Where an annotation's passage is now. Its sentence range is checked against
 * the saved quote; if the text changed (e.g. a correction), the quote is
 * searched for nearby. Returns null when it can't be found confidently.
 */
export function locate(a: Annotation, segments: Segment[]): { start: number; end: number } | null {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const quote = norm(a.quote);
  const at = (s: number, e: number) =>
    norm(
      segments
        .slice(s, e + 1)
        .map((x) => x.t)
        .join(" ")
    );
  const len = a.end - a.start;
  if (a.end < segments.length && at(a.start, a.end) === quote) return { start: a.start, end: a.end };
  const head = quote.slice(0, 40);
  for (let d = 1; d <= 50; d++) {
    for (const s of [a.start - d, a.start + d]) {
      if (s < 0 || s + len >= segments.length) continue;
      if (at(s, s + len) === quote || (head.length >= 20 && norm(segments[s].t).startsWith(head))) return { start: s, end: s + len };
    }
  }
  return null;
}

/** Annotations covering each sentence, for drawing highlights. */
export function bySentence(annotations: Annotation[]): Map<number, Annotation[]> {
  const map = new Map<number, Annotation[]>();
  for (const a of annotations) {
    for (let i = a.start; i <= a.end; i++) {
      const list = map.get(i) ?? [];
      list.push(a);
      map.set(i, list);
    }
  }
  return map;
}

export interface AnnotationFilter {
  query?: string;
  bookId?: string | null;
  kind?: AnnotationKind | null;
  color?: HighlightColor | null;
  /** Only items created at or after this time. */
  since?: number | null;
}

export function filterAnnotations(list: Annotation[], f: AnnotationFilter): Annotation[] {
  const q = f.query?.trim().toLowerCase();
  return list.filter(
    (a) =>
      (!f.bookId || a.bookId === f.bookId) &&
      (!f.kind || a.kind === f.kind) &&
      (!f.color || a.color === f.color) &&
      (!f.since || a.createdAt >= f.since) &&
      (!q || a.quote.toLowerCase().includes(q) || a.note.toLowerCase().includes(q))
  );
}

// ---------- export ----------

export interface ExportBook {
  id: string;
  title: string;
}

const iso = (t: number) => new Date(t).toISOString();
const where = (a: Annotation) => (a.page ? `p. ${a.page}` : `sentence ${a.start + 1}`);

export function toMarkdown(list: Annotation[], books: ExportBook[]): string {
  const out: string[] = ["# Flybook notes", ""];
  for (const book of books) {
    const items = list.filter((a) => a.bookId === book.id);
    if (!items.length) continue;
    out.push(`## ${book.title}`, "");
    for (const a of items) {
      const label = a.kind === "bookmark" ? "Bookmark" : a.kind === "note" ? "Note" : `Highlight (${a.color ?? "amber"})`;
      out.push(`### ${label} · ${where(a)}`, "");
      if (a.quote) out.push(...a.quote.split("\n").map((l) => `> ${l}`), "");
      if (a.note) out.push(a.note, "");
      out.push(`*Created ${iso(a.createdAt)}${a.updatedAt !== a.createdAt ? ` · edited ${iso(a.updatedAt)}` : ""}*`, "");
    }
  }
  return out.join("\n");
}

export function toJSON(list: Annotation[], books: ExportBook[]): string {
  const titles = new Map(books.map((b) => [b.id, b.title]));
  return JSON.stringify(
    {
      app: "Flybook",
      exportedAt: iso(Date.now()),
      annotations: list.map((a) => ({
        document: titles.get(a.bookId) ?? null,
        documentId: a.bookId,
        kind: a.kind,
        page: a.page,
        sentenceStart: a.start + 1,
        sentenceEnd: a.end + 1,
        quote: a.quote,
        color: a.color,
        note: a.note,
        created: iso(a.createdAt),
        modified: iso(a.updatedAt),
      })),
    },
    null,
    2
  );
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  // Quote everything that needs it; prefix formula-like cells so spreadsheets don't run them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(list: Annotation[], books: ExportBook[]): string {
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const rows: (string | number | null)[][] = [["document", "kind", "page", "sentence", "quote", "color", "note", "created", "modified"]];
  for (const a of list) {
    rows.push([titles.get(a.bookId) ?? "", a.kind, a.page, a.start + 1, a.quote, a.color, a.note, iso(a.createdAt), iso(a.updatedAt)]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Saves text as a file on the user's device. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
