import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBookText, splitLong, splitSentences, stripHeadersAndFooters, type PageLines } from "../shared/text.ts";

const line = (text: string, y: number, fontSize = 11) => ({ text, y, height: fontSize, fontSize });

test("splits sentences without breaking on abbreviations", () => {
  assert.deepEqual(splitSentences("Dr. Smith arrived. He sat down! Was it late? Yes."), [
    "Dr. Smith arrived.",
    "He sat down!",
    "Was it late?",
    "Yes.",
  ]);
  assert.deepEqual(splitSentences("See e.g. the appendix for more."), ["See e.g. the appendix for more."]);
});

test("long sentences are split at natural breaks under the limit", () => {
  const long = Array.from({ length: 40 }, (_, i) => `clause number ${i}`).join(", ") + ".";
  const parts = splitLong(long);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 260, `too long: ${p.length}`);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
});

test("removes running headers and page numbers", () => {
  const pages: PageLines[] = Array.from({ length: 6 }, (_, i) => ({
    page: i + 1,
    lines: [line("The Great Book", 20), line(`Body text on page ${i + 1}.`, 60), line(String(i + 1), 780)],
  }));
  const stripped = stripHeadersAndFooters(pages);
  for (const p of stripped) assert.deepEqual(p.lines.map((l) => l.text), [`Body text on page ${p.page}.`]);
});

test("joins hyphenated words and paragraphs across lines, detects headings as chapters", () => {
  const pages: PageLines[] = [
    {
      page: 1,
      lines: [line("Chapter One", 50, 22), line("It was a beauti-", 90), line("ful morning. The end", 104), line("came soon.", 118)],
    },
    { page: 2, lines: [line("Chapter Two", 50, 22), line("A second start.", 90)] },
  ];
  const { segments, chapters } = buildBookText(pages);
  assert.deepEqual(
    segments.map((s) => s.t),
    ["Chapter One", "It was a beautiful morning.", "The end came soon.", "Chapter Two", "A second start."]
  );
  assert.equal(segments[0].h, 1);
  assert.deepEqual(chapters, [
    { title: "Chapter One", start: 0 },
    { title: "Chapter Two", start: 3 },
  ]);
});

test("paragraph continues across a page break mid-sentence", () => {
  const pages: PageLines[] = [
    { page: 1, lines: [line("This sentence runs onto", 700)] },
    { page: 2, lines: [line("the next page. New one.", 60)] },
  ];
  const { segments } = buildBookText(pages);
  assert.deepEqual(segments.map((s) => s.t), ["This sentence runs onto the next page.", "New one."]);
});

test("uses the PDF outline for chapters when present", () => {
  const pages: PageLines[] = [1, 2, 3].map((p) => ({ page: p, lines: [line(`Text of page ${p}.`, 60)] }));
  const { chapters } = buildBookText(pages, [
    { title: "Intro", page: 1 },
    { title: "Part B", page: 3 },
  ]);
  assert.deepEqual(chapters, [
    { title: "Intro", start: 0 },
    { title: "Part B", start: 2 },
  ]);
});

test("falls back to page-range chapters when there is no structure", () => {
  const pages: PageLines[] = Array.from({ length: 25 }, (_, i) => ({ page: i + 1, lines: [line(`Page ${i + 1} words here.`, 60)] }));
  const { chapters } = buildBookText(pages);
  assert.deepEqual(chapters.map((c) => c.title), ["Pages 1–10", "Pages 11–20", "Pages 21–25"]);
});
