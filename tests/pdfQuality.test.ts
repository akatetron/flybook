import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPdf } from "../src/lib/pdfQuality.ts";

test("a short one-page letter with real text is sparse, not scanned", () => {
  assert.equal(classifyPdf([{ chars: 35, hasImage: false }]), "sparse");
});
test("ordinary text pages are text", () => {
  assert.equal(classifyPdf(Array(10).fill({ chars: 1800, hasImage: false })), "text");
});
test("pages that are only images are image-only", () => {
  assert.equal(classifyPdf(Array(5).fill({ chars: 0, hasImage: true })), "image-only");
});
test("no text and no images is empty, not called a scan", () => {
  assert.equal(classifyPdf([{ chars: 0, hasImage: false }]), "empty");
  assert.equal(classifyPdf([{ chars: 0, hasImage: null }]), "empty");
});
test("a text document with several scanned pages is partly scanned", () => {
  const pages = [...Array(6).fill({ chars: 1500, hasImage: false }), ...Array(3).fill({ chars: 0, hasImage: true })];
  assert.equal(classifyPdf(pages), "partly-scanned");
});
test("one blank page with a picture in a text document stays text", () => {
  assert.equal(classifyPdf([...Array(9).fill({ chars: 1500, hasImage: false }), { chars: 0, hasImage: true }]), "text");
});
