import type { OutlineEntry, PageLines } from "../../../../shared/text";

export interface SystemVoice {
  id: string;
  name: string;
  /** BCP-47, e.g. "en-US". */
  language: string;
  /** Higher-quality downloadable voices (iOS Enhanced/Premium, Android high quality). */
  enhanced: boolean;
}

export interface RenderResult {
  /** Length of the written audio, in milliseconds. */
  durationMs: number;
}

export interface PdfText {
  pageCount: number;
  title: string | null;
  pages: PageLines[];
  outline: OutlineEntry[];
}
