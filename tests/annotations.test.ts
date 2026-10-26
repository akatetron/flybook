import { test } from "node:test";
import assert from "node:assert/strict";
import { bySentence, filterAnnotations, locate, makeAnnotation, toCSV, toJSON, toMarkdown } from "../src/lib/annotations.ts";

const segs = [
  { t: "Chapter One", p: 1, b: 1 as const, h: 1 as const },
  { t: "The lamp was lit at dusk.", p: 1 },
  { t: "Nobody knew who lit it.", p: 2 },
  { t: "The keeper said nothing.", p: 2 },
];
const now = Date.UTC(2026, 0, 2);
const book = [{ id: "b1", title: "The Lighthouse Library" }];

test("an annotation records the passage, page and color", () => {
  const a = makeAnnotation("b1", segs, "highlight", 2, 1, { id: "a", now });
  assert.deepEqual([a.start, a.end, a.page, a.color], [1, 2, 1, "amber"]);
  assert.equal(a.quote, "The lamp was lit at dusk. Nobody knew who lit it.");
});

test("locate finds a passage that moved after sentences were added", () => {
  const a = makeAnnotation("b1", segs, "note", 3, 3, { id: "a", now, note: "why?" });
  const moved = [segs[0], { t: "An added sentence.", p: 1 }, ...segs.slice(1)];
  assert.deepEqual(locate(a, moved), { start: 4, end: 4 });
  assert.equal(locate(a, [{ t: "Different text entirely.", p: 1 }]), null);
});

test("bySentence covers every sentence of a range", () => {
  const a = makeAnnotation("b1", segs, "highlight", 1, 3, { id: "a", now });
  assert.deepEqual([...bySentence([a]).keys()], [1, 2, 3]);
});

test("filters by text, kind, colour and date", () => {
  const list = [
    makeAnnotation("b1", segs, "highlight", 1, 1, { id: "1", now, color: "blue" }),
    makeAnnotation("b1", segs, "note", 2, 2, { id: "2", now: now + 10, note: "Who lit the lamp?" }),
    makeAnnotation("b1", segs, "bookmark", 3, 3, { id: "3", now: now + 20 }),
  ];
  assert.deepEqual(filterAnnotations(list, { query: "who lit" }).map((a) => a.id), ["2"]);
  assert.deepEqual(filterAnnotations(list, { kind: "bookmark" }).map((a) => a.id), ["3"]);
  assert.deepEqual(filterAnnotations(list, { color: "blue" }).map((a) => a.id), ["1"]);
  assert.deepEqual(filterAnnotations(list, { since: now + 5 }).map((a) => a.id), ["2", "3"]);
});

test("exports keep the document title, page, quote, note and dates", () => {
  const list = [makeAnnotation("b1", segs, "note", 2, 2, { id: "n", now, note: "Ask the keeper" })];
  const md = toMarkdown(list, book);
  assert.match(md, /## The Lighthouse Library/);
  assert.match(md, /### Note · p\. 2/);
  assert.match(md, /> Nobody knew who lit it\./);
  assert.match(md, /Ask the keeper/);
  const json = JSON.parse(toJSON(list, book));
  assert.equal(json.annotations[0].document, "The Lighthouse Library");
  assert.equal(json.annotations[0].page, 2);
  assert.equal(json.annotations[0].created, "2026-01-02T00:00:00.000Z");
});

test("CSV quotes commas and quotes and defuses formulas", () => {
  const a = makeAnnotation("b1", [{ t: 'He said "no", then left.', p: 3 }], "highlight", 0, 0, { id: "x", now, note: "=SUM(A1)" });
  const csv = toCSV([a], book);
  const [header, row] = csv.trim().split("\r\n");
  assert.equal(header, "document,kind,page,sentence,quote,color,note,created,modified");
  assert.ok(row.includes('"He said ""no"", then left."'));
  assert.ok(row.includes(`"'=SUM(A1)"`));
});
