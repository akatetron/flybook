import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "idb";

test("upgrading the library database from version 1 keeps existing books", async () => {
  // A library as version 1 of the app left it.
  const v1 = await openDB("flybook", 1, {
    upgrade(d) {
      d.createObjectStore("books", { keyPath: "id" });
      d.createObjectStore("contents", { keyPath: "id" });
    },
  });
  await v1.put("books", { id: "b1", title: "Old book", fileName: "old.pdf", pageCount: 3, segmentCount: 2, words: 9, cover: null, addedAt: 1, openedAt: 1, position: 1 });
  await v1.put("contents", { id: "b1", segments: [{ t: "One.", p: 1 }, { t: "Two.", p: 2 }], chapters: [] });
  v1.close();

  const db = await import("../src/lib/db.ts");
  const found = await db.getBook("b1");
  assert.equal(found?.meta.title, "Old book");
  assert.equal(found?.meta.position, 1);
  assert.equal(found?.content.segments.length, 2);

  // The new stores work, and deleting a book removes its annotations too.
  await db.saveAnnotation({ id: "a1", bookId: "b1", kind: "bookmark", start: 1, end: 1, page: 2, quote: "Two.", color: null, note: "", createdAt: 1, updatedAt: 1 });
  assert.equal((await db.listAnnotations("b1")).length, 1);
  await db.deleteBook("b1");
  assert.equal(await db.getBook("b1"), null);
  assert.equal((await db.listAnnotations()).length, 0);
});
