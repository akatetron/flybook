import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError, isStorageError, isStorageFull } from "../src/lib/errors.ts";

test("quota errors are recognised by name, code and message", () => {
  assert.ok(isStorageFull(new DOMException("over", "QuotaExceededError")));
  assert.ok(isStorageFull({ name: "Error", code: 22 }));
  assert.ok(isStorageFull(new Error("The quota has been exceeded.")));
  assert.ok(!isStorageFull(new Error("network down")));
  assert.ok(isStorageError(new DOMException("x", "UnknownError")));
});

test("messages tell the listener what to do", () => {
  assert.match(describeError(new DOMException("over", "QuotaExceededError"), "save your note"), /^Couldn't save your note: .*storage .* is full\. Free space in Storage/);
  assert.match(describeError(new DOMException("x", "InvalidStateError")), /storage isn't available/);
  assert.equal(describeError(new Error("boom"), "export"), "Couldn't export: boom");
});
