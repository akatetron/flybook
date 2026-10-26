// Judges what a PDF's extracted text says about the document, from evidence
// gathered during import: characters of text per page and whether a page
// draws images. A short document with real text is not "scanned".
export type PdfTextKind =
  /** Readable text throughout. */
  | "text"
  /** Real text, but little of it (a short letter, a slide deck). */
  | "sparse"
  /** Mostly text, but some pages are images with no text (likely scanned pages). */
  | "partly-scanned"
  /** No text at all, and pages are images: very likely a scan. Needs OCR. */
  | "image-only"
  /** No text and no images found. */
  | "empty";

export interface PageEvidence {
  chars: number;
  /** Page draws at least one image; null when not checked. */
  hasImage: boolean | null;
}

export function classifyPdf(pages: PageEvidence[]): PdfTextKind {
  const total = pages.reduce((n, p) => n + p.chars, 0);
  const textless = pages.filter((p) => p.chars < 3);
  const textlessWithImages = textless.filter((p) => p.hasImage === true);
  if (total === 0 || textless.length === pages.length) {
    return textlessWithImages.length > 0 ? "image-only" : "empty";
  }
  // Several pages are pictures without text, alongside pages with text.
  if (textlessWithImages.length >= Math.max(2, pages.length * 0.25)) return "partly-scanned";
  const perPage = total / pages.length;
  return perPage < 200 ? "sparse" : "text";
}

export const KIND_MESSAGE: Record<PdfTextKind, string | null> = {
  text: null,
  sparse: "This PDF has only a little text, so the audiobook will be short.",
  "partly-scanned":
    "Some pages look like scanned images without text. Those pages can't be read aloud — text recognition (OCR) isn't available in Flybook yet.",
  "image-only":
    "This PDF has no text layer — its pages appear to be scanned images. Flybook can't read it aloud: text recognition (OCR) isn't available yet.",
  empty: "This PDF doesn't contain any text to read.",
};
