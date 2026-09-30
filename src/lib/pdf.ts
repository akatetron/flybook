// Reads a PDF entirely on the device with pdf.js and turns it into book text.
// The legacy build is used on purpose: it supports older phone browsers.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { buildBookText, type BookText, type Line, type OutlineEntry, type PageLines } from "./text";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ImportedPdf extends BookText {
  title: string;
  pageCount: number;
  cover: string | null;
}

export class ScannedPdfError extends Error {
  constructor() {
    super("This PDF has no readable text — it looks like scanned images.");
  }
}

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

interface RawItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

/** Groups pdf.js text items into visual lines, in the order pdf.js gives them. */
function itemsToLines(items: RawItem[], pageHeight: number): Line[] {
  const lines: Line[] = [];
  let text = "";
  let sizes: number[] = [];
  let y = 0;
  let height = 0;
  let lastBaseline: number | null = null;

  const push = () => {
    if (text.trim()) {
      const fontSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      lines.push({ text: text.replace(/\s+/g, " ").trim(), fontSize, y, height });
    }
    text = "";
    sizes = [];
    lastBaseline = null;
  };

  for (const item of items) {
    const [a, b, , d, , f] = item.transform;
    const size = Math.hypot(a, b) || Math.abs(d) || item.height;
    const baseline = pageHeight - f;
    if (lastBaseline !== null && Math.abs(baseline - lastBaseline) > size * 0.6) push();
    if (item.str) {
      if (lastBaseline === null) {
        y = baseline - size;
        height = size;
      }
      text += item.str;
      if (item.str.trim()) sizes.push(size);
      lastBaseline = baseline;
    }
    if (item.hasEOL) push();
  }
  push();
  return lines;
}

async function readOutline(doc: PdfDoc): Promise<OutlineEntry[]> {
  try {
    const outline = await doc.getOutline();
    if (!outline) return [];
    const entries: OutlineEntry[] = [];
    // Top level, plus one level down when the top level is just a single
    // wrapper entry (common: the book title containing all chapters).
    const items = outline.length === 1 && outline[0].items?.length ? outline[0].items : outline;
    for (const item of items) {
      let dest = item.dest;
      if (typeof dest === "string") dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      const ref = dest[0];
      const index = typeof ref === "number" ? ref : await doc.getPageIndex(ref);
      entries.push({ title: item.title, page: index + 1 });
    }
    return entries;
  } catch {
    return [];
  }
}

async function renderCover(doc: PdfDoc): Promise<string | null> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 240 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

function cleanTitle(metaTitle: unknown, fileName: string): string {
  const fromFile = fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
  if (typeof metaTitle !== "string") return fromFile;
  const t = metaTitle.trim();
  // Metadata titles are often junk like "Microsoft Word - draft3.docx".
  if (!t || t.length < 3 || /^(untitled|microsoft word|document\d*)|\.(docx?|pdf|indd|tex)$/i.test(t)) return fromFile;
  return t;
}

export async function importPdf(
  file: File,
  onProgress: (done: number, total: number) => void
): Promise<ImportedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const pages: PageLines[] = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is RawItem & (typeof content.items)[number] => "str" in i);
      const lines = itemsToLines(items as RawItem[], viewport.height);
      for (const l of lines) chars += l.text.length;
      pages.push({ page: n, lines });
      page.cleanup();
      onProgress(n, doc.numPages);
    }
    if (chars < Math.max(40, doc.numPages * 20)) throw new ScannedPdfError();

    const [outline, cover, meta] = await Promise.all([
      readOutline(doc),
      renderCover(doc),
      doc.getMetadata().catch(() => null),
    ]);
    const text = buildBookText(pages, outline);
    const info = meta?.info as { Title?: unknown } | undefined;
    return { ...text, title: cleanTitle(info?.Title, file.name), pageCount: doc.numPages, cover };
  } finally {
    await task.destroy();
  }
}
