import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { G2P, Lexicon, cardinal, ordinal, year } from "../shared/g2p.ts";

const lexicon = JSON.parse(readFileSync(new URL("../mobile/assets/kokoro/us_lexicon.txt", import.meta.url), "utf8"));
const g2p = new G2P(new Lexicon(lexicon.gold, lexicon.silver));
// Kokoro v1.0 phoneme set (misaki US vocabulary, with T and t for flap/glottal stop).
const KOKORO = new Set("AIOWYbdfhijklmnpstuvwzæðŋɑɔəɛɜɡɪɹʃʊʌʒʤʧˈˌθᵊᵻT ;:,.!?—…\"“”()ɐ");

test("dictionary words", () => {
  assert.equal(g2p.phonemize("Hello, world!"), "həlˈO, wˈɜɹld!");
  assert.equal(g2p.phonemize("lighthouse"), "lˈIthˌWs");
});

test("the and a/an depend on the next sound", () => {
  assert.match(g2p.phonemize("the owl"), /^ði /);
  assert.match(g2p.phonemize("the cat"), /^ðə /);
  assert.match(g2p.phonemize("an owl"), /^ɐn /);
});

test("plurals, past tense and -ing are built from the stem", () => {
  assert.equal(g2p.phonemize("walked"), "wˈɔkt");
  assert.equal(g2p.phonemize("cats"), "kˈæts");
  assert.match(g2p.phonemize("humming"), /ɪŋ$/);
});

test("numbers, years, money and ordinals", () => {
  assert.equal(cardinal(1984), "one thousand nine hundred eighty-four");
  assert.equal(year(1984), "nineteen eighty-four");
  assert.equal(ordinal(21), "twenty-first");
  assert.equal(ordinal(12), "twelfth");
  assert.match(g2p.phonemize("In 1984, it cost $3.50."), /nˌIntˈin ˈATi.*dˈɑləɹz.*sˈɛnts/);
});

test("unknown words still produce Kokoro phonemes", () => {
  const out = g2p.phonemize("The Zorblax probe hummed quietly.");
  assert.ok(out.length > 10);
  for (const ch of out) assert.ok(KOKORO.has(ch), `unexpected phoneme ${JSON.stringify(ch)} in ${out}`);
});
