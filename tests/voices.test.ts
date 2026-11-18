import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_VOICES, DEFAULT_PHONE_VOICE, REMOVED_VOICES, migrateVoice, offeredVoices, studioVoice } from "../src/tts/voices.ts";

test("non-commercial voices are gone from the catalogue", () => {
  for (const id of Object.keys(REMOVED_VOICES)) assert.ok(!ALL_VOICES.some((v) => v.id === id), id);
  assert.ok(!ALL_VOICES.some((v) => /lessac|ryan/.test(v.id)));
});

test("every voice records its licence and where it was checked", () => {
  for (const v of ALL_VOICES) {
    assert.ok(v.license.name.length > 3, v.id);
    assert.match(v.license.url, /^https:\/\//, v.id);
  }
});

test("a commercial build offers only voices verified for commercial use", () => {
  const paid = offeredVoices(true);
  assert.ok(paid.every((v) => v.license.commercial === "yes"));
  assert.ok(!paid.some((v) => /amy|alan/.test(v.id)));
  assert.ok(offeredVoices(false).length > paid.length);
});

test("saved choices of removed voices move to a licensed replacement", () => {
  assert.equal(migrateVoice("piper:en_US-lessac-medium"), "piper:en_US-kristin-medium");
  assert.equal(migrateVoice("piper:en_US-ryan-medium"), "piper:en_US-joe-medium");
  assert.equal(migrateVoice("af_heart"), "af_heart");
  for (const { replacement } of Object.values(REMOVED_VOICES)) {
    assert.equal(ALL_VOICES.find((v) => v.id === replacement)?.license.commercial, "yes");
  }
  assert.equal(studioVoice("piper:en_US-lessac-medium").name, "Kristin");
});

test("the phone default voice is commercially licensed", () => {
  assert.equal(ALL_VOICES.find((v) => v.id === DEFAULT_PHONE_VOICE)?.license.commercial, "yes");
});
