// Optional narration filters for academic and legal documents. They change
// only what is spoken; the displayed text, notes and exports keep the
// original. Each filter is deliberately conservative: when a pattern isn't
// clearly a citation it is left alone.
import type { Chapter, Segment } from "./text";

/** Numeric citations like [12], [3, 4], [4]–[7], [1-3]. */
const NUMERIC = /\s?\[(?:\d{1,3}(?:\s?[-–,]\s?\d{1,3})*)\](?:\s?[-–]\s?\[\d{1,3}\])?/g;
/** Author–year citations like (Smith, 2020), (Lee et al., 2019; Ng & Ho 2021a). */
const AUTHOR_YEAR =
  /\s?\((?:see |cf\. |e\.g\.,? )?(?:[A-Z][\p{L}'’-]+(?: et al\.)?(?:,? (?:and|&) [A-Z][\p{L}'’-]+)?,? (?:\d{4}[a-z]?|n\.d\.)(?:, p+\. ?\d+(?:[-–]\d+)?)?(?:; ?)?)+\)/gu;

export function stripCitations(text: string): string {
  const out = text.replace(NUMERIC, "").replace(AUTHOR_YEAR, "");
  // Tidy spaces left before punctuation.
  return out.replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim() || text;
}

const REFERENCE_HEADINGS = /^(?:\d+\.?\s+)?(references|bibliography|works cited|literature cited|sources|notes and references)\.?$/i;

/** Sentence indices of reference/bibliography sections (heading to the next chapter). */
export function referenceSections(segments: Segment[], chapters: Chapter[]): Set<number> {
  const skip = new Set<number>();
  const starts = [...chapters.map((c) => c.start)].sort((a, b) => a - b);
  segments.forEach((s, i) => {
    if (!s.h || !REFERENCE_HEADINGS.test(s.t.trim())) return;
    const next = starts.find((c) => c > i) ?? segments.length;
    // The heading itself stays audible so the listener knows what was skipped.
    for (let j = i + 1; j < next; j++) skip.add(j);
  });
  return skip;
}
