import { test } from "node:test";
import assert from "node:assert/strict";
import { joinWavs, parseWav, wavHeader, WavError } from "../src/lib/wav.ts";

const clip = (samples: number[], sampleRate = 24000) => {
  const data = new Int16Array(samples);
  return new Blob([wavHeader({ sampleRate, channels: 1, bitsPerSample: 16 }, data.byteLength), data.buffer], { type: "audio/wav" });
};

test("joined clips form one valid WAV with all samples in order", async () => {
  const { blob, seconds } = await joinWavs([clip([1, 2, 3]), clip([4, 5])]);
  const buf = await blob.arrayBuffer();
  const parsed = parseWav(buf);
  assert.equal(parsed.sampleRate, 24000);
  assert.equal(parsed.dataLength, 10);
  assert.deepEqual([...new Int16Array(buf.slice(parsed.dataOffset))], [1, 2, 3, 4, 5]);
  assert.equal(seconds, 5 / 24000);
});

test("clips with different sample rates are refused", async () => {
  await assert.rejects(joinWavs([clip([1], 24000), clip([1], 22050)]), WavError);
});

test("a damaged clip is refused", async () => {
  await assert.rejects(joinWavs([clip([1]), new Blob([new Uint8Array(50)])]), WavError);
});

test("export can be cancelled", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(joinWavs([clip([1])], { signal: ac.signal }), { name: "AbortError" });
});
