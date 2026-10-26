import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceSections, stripCitations } from "../shared/narration.ts";

test("numeric citations are removed from speech", () => {
  assert.equal(stripCitations("Prior work [12] disagrees [3, 4]."), "Prior work disagrees.");
  assert.equal(stripCitations("See refs. [4]–[7] and [1-3] for details."), "See refs. and for details.");
});

test("author-year citations are removed", () => {
  assert.equal(stripCitations("This was shown before (Smith, 2020)."), "This was shown before.");
  assert.equal(stripCitations("Several studies agree (Lee et al., 2019; Ng & Ho 2021a)."), "Several studies agree.");
});

test("ordinary brackets, years and legal text are left alone", () => {
  for (const t of [
    "The results (shown in Table 3) were clear.",
    "In 1998 the law changed [see below].",
    "See Smith v. Jones, 410 U.S. 113, 115 (1973).",
    "Section 2(b)(iii) applies.",
  ]) assert.equal(stripCitations(t), t);
});

test("reference sections are skipped up to the next chapter, keeping the heading", () => {
  const segs = [
    { t: "Introduction", p: 1, h: 1 as const, b: 1 as const },
    { t: "Body.", p: 1 },
    { t: "References", p: 2, h: 1 as const, b: 1 as const },
    { t: "Smith J. (2020) A paper.", p: 2 },
    { t: "Lee K. (2019) Another.", p: 2 },
    { t: "Appendix", p: 3, h: 1 as const, b: 1 as const },
    { t: "Extra.", p: 3 },
  ];
  const chapters = [{ title: "Introduction", start: 0 }, { title: "References", start: 2 }, { title: "Appendix", start: 5 }];
  assert.deepEqual([...referenceSections(segs, chapters)], [3, 4]);
});
