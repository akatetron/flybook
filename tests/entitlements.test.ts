import { test } from "node:test";
import assert from "node:assert/strict";
import { can, features, isPro } from "../src/lib/entitlements.ts";

test("no one has Pro until a payment provider exists, and every feature is free", () => {
  assert.equal(isPro(), false);
  for (const f of Object.keys(features) as (keyof typeof features)[]) assert.equal(can(f), true, f);
});
