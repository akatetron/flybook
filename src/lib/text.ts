// Pure text-processing helpers: turn positioned PDF text lines into clean,
// speakable segments (roughly one sentence each) plus a chapter list.
// No DOM or pdf.js here so it can be unit-tested in Node.

export interface Line {
  text: string;
  fontSize: number;
  /** Top of the line, in page units, measured from the top of the page. */
  y: number;
  height: number;
}

export interface PageLines {
  page: number;
  lines: Line[];
}

export interface Segment {
  /** Text to display and speak. */
  t: string;
  /** 1-based page the segment starts on. */
  p: number;
  /** Starts a new paragraph. */
  b?: 1;
  /** Is a heading. */
  h?: 1;
}

export interface Chapter {
  title: string;
  /** Index of the first segment of the chapter. */
  start: number;
}

/** Longest segment we hand to the TTS engine in one go. */
const MAX_SEGMENT_CHARS = 260;

// ---------- Headers, footers and page numbers ----------

const PAGE_NUMBER = /^(page\s*)?[\divxlc]+(\s*(of|\/)\s*\d+)?$/i;

function normalizeForRepeat(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * Removes running headers/footers (lines repeated at the top or bottom of
 * many pages, e.g. the book title or "Chapter 3") and bare page numbers.
 */
export function stripHeadersAndFooters(pages: PageLines[]): PageLines[] {
  // Short pages only have room for one header and one footer line.
  const edgeSize = (lines: Line[]) => (lines.length >= 6 ? 2 : 1);
  // Prose (a real sentence) is never treated as a running header.
  const looksLikeProse = (text: string) => /[.!?"”]$/.test(text) && text.split(/\s+/).length >= 3;
  const counts = new Map<string, number>();
  for (const { lines } of pages) {
    const seen = new Set<string>();
    const edge = edgeSize(lines);
    for (const line of [...lines.slice(0, edge), ...lines.slice(-edge)]) {
      if (line.text.length > 90 || looksLikeProse(line.text.trim())) continue;
      const key = normalizeForRepeat(line.text);
      if (key && !seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));

  return pages.map(({ page, lines }) => {
    const edge = edgeSize(lines);
    const isEdge = (i: number) => i < edge || i >= lines.length - edge;
    return {
      page,
      lines: lines.filter((line, i) => {
        const text = line.text.trim();
        if (!text) return false;
        if (!isEdge(i)) return true;
        if (PAGE_NUMBER.test(text)) return false;
        if (text.length > 90 || looksLikeProse(text)) return true;
        return (counts.get(normalizeForRepeat(text)) ?? 0) < threshold;
      }),
    };
  });
}

// ---------- Blocks (paragraphs and headings) ----------

interface Block {
  text: string;
  page: number;
  heading: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Joins two lines, repairing words hyphenated across the line break. */
function joinLines(a: string, b: string): string {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

const ENDS_SENTENCE = /[.!?…:"”’)\]]$/;

function buildBlocks(pages: PageLines[]): Block[] {
  const allLines = pages.flatMap((p) => p.lines);
  const bodySize = median(allLines.map((l) => l.fontSize).filter((s) => s > 0)) || 10;
  const isHeadingLine = (line: Line) => {
    const letters = line.text.replace(/[^\p{L}]/gu, "").length;
    return line.fontSize >= bodySize * 1.3 && line.text.length <= 90 && letters >= 3;
  };

  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current && current.text.trim()) blocks.push({ ...current, text: current.text.trim() });
    current = null;
  };

  for (const { page, lines } of pages) {
    let prev: Line | null = null;
    for (const line of lines) {
      const text = line.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const heading = isHeadingLine(line);

      let startNew = false;
      if (!current) startNew = true;
      else if (heading !== current.heading) startNew = true;
      else if (prev) {
        // A vertical gap noticeably bigger than a normal line step starts a
        // new paragraph. So does a short previous line that ended a sentence.
        const gap = line.y - (prev.y + prev.height);
        if (gap > Math.max(prev.height, line.height) * 0.9) startNew = true;
        else if (heading && gap > line.height * 0.6) startNew = true;
      } else if (current && !heading) {
        // First line of a new page: continue the paragraph only if the last
        // one clearly didn't finish its sentence.
        if (ENDS_SENTENCE.test(current.text)) startNew = true;
      }

      if (startNew) {
        flush();
        current = { text, page, heading };
      } else if (current) {
        current.text = joinLines(current.text, text);
      }
      prev = line;
    }
    // Headings never run across a page boundary.
    if (current?.heading) flush();
  }
  flush();
  return blocks;
}

// ---------- Sentences ----------

type SegmenterCtor = new (
  locale?: string,
  options?: { granularity: "sentence" }
) => { segment(input: string): Iterable<{ segment: string }> };

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
const sentenceSegmenter = Segmenter ? new Segmenter(undefined, { granularity: "sentence" }) : null;

const ABBREVIATION = /\b(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|fig|no|vol|ch|pp?)\.$/i;

export function splitSentences(text: string): string[] {
  let parts: string[];
  if (sentenceSegmenter) {
    parts = Array.from(sentenceSegmenter.segment(text), (s) => s.segment);
  } else {
    parts = text.split(/(?<=[.!?…]["”’)\]]?)\s+(?=["“‘(\[]?[A-Z0-9])/);
  }
  // Re-join splits that happened right after a common abbreviation.
  const merged: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const last = merged[merged.length - 1];
    if (last && (ABBREVIATION.test(last) || /^[a-z]/.test(part))) {
      merged[merged.length - 1] = `${last} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.flatMap(splitLong);
}

/** Splits an over-long sentence at the most natural break before the limit. */
export function splitLong(sentence: string): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SEGMENT_CHARS) {
    const window = rest.slice(0, MAX_SEGMENT_CHARS);
    let cut = -1;
    for (const pattern of [/[;:—–]\s/g, /,\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      let best = -1;
      while ((m = pattern.exec(window))) {
        if (m.index > MAX_SEGMENT_CHARS * 0.4) best = m.index + 1;
      }
      if (best > 0) {
        cut = best;
        break;
      }
    }
    if (cut <= 0) cut = MAX_SEGMENT_CHARS;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// ---------- Putting it together ----------

export interface OutlineEntry {
  title: string;
  page: number;
}

export interface BookText {
  segments: Segment[];
  chapters: Chapter[];
  words: number;
}

export function buildBookText(rawPages: PageLines[], outline: OutlineEntry[] = []): BookText {
  const pages = stripHeadersAndFooters(rawPages);
  const blocks = buildBlocks(pages);

  const segments: Segment[] = [];
  const headingStarts: { title: string; start: number }[] = [];
  for (const block of blocks) {
    if (block.heading) {
      headingStarts.push({ title: block.text, start: segments.length });
      segments.push({ t: block.text, p: block.page, b: 1, h: 1 });
      continue;
    }
    splitSentences(block.text).forEach((t, i) => {
      segments.push(i === 0 ? { t, p: block.page, b: 1 } : { t, p: block.page });
    });
  }

  const words = segments.reduce((n, s) => n + s.t.split(/\s+/).length, 0);
  return { segments, chapters: buildChapters(segments, outline, headingStarts, rawPages.length), words };
}

function firstSegmentOnOrAfterPage(segments: Segment[], page: number): number {
  const i = segments.findIndex((s) => s.p >= page);
  return i === -1 ? segments.length - 1 : i;
}

function buildChapters(
  segments: Segment[],
  outline: OutlineEntry[],
  headings: { title: string; start: number }[],
  pageCount: number
): Chapter[] {
  if (segments.length === 0) return [];

  let chapters: Chapter[] = [];
  if (outline.length >= 2) {
    chapters = outline.map((o) => ({ title: o.title.trim() || `Page ${o.page}`, start: firstSegmentOnOrAfterPage(segments, o.page) }));
  } else if (headings.length >= 2 && headings.length <= Math.max(60, pageCount)) {
    chapters = headings.map((h) => ({ title: h.title, start: h.start }));
  } else {
    // No structure found: offer page ranges so long books are still navigable.
    const step = pageCount > 60 ? 20 : 10;
    for (let page = 1; page <= pageCount; page += step) {
      const start = firstSegmentOnOrAfterPage(segments, page);
      const end = Math.min(pageCount, page + step - 1);
      chapters.push({ title: page === end ? `Page ${page}` : `Pages ${page}–${end}`, start });
    }
  }

  // Sort, drop duplicates that point at the same place, and make sure the
  // very beginning of the book is reachable.
  chapters.sort((a, b) => a.start - b.start);
  const deduped: Chapter[] = [];
  for (const c of chapters) {
    if (deduped.length && deduped[deduped.length - 1].start === c.start) continue;
    deduped.push(c);
  }
  if (deduped.length === 0 || deduped[0].start > 0) deduped.unshift({ title: "Beginning", start: 0 });
  return deduped;
}

/** Text as handed to the speech engine (headings get a pause after them). */
export function speakable(segment: Segment): string {
  const t = segment.t;
  return segment.h && !ENDS_SENTENCE.test(t) ? `${t}.` : t;
}
