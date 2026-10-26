import { test } from "node:test";
import assert from "node:assert/strict";
import { checkModel, kokoroModel, piperModel, piperPath, removeModel, repairModel, type CacheStorageLike } from "../src/tts/registry.ts";

/** In-memory stand-in for Cache Storage: url -> { size, contentLength }. */
function fakeCaches(files: Record<string, { size: number; contentLength?: number }>): CacheStorageLike & { files: typeof files } {
  const store = { ...files };
  return {
    files: store,
    async open() {
      return {
        async match(url: string) {
          const f = store[url];
          if (!f) return undefined;
          return {
            headers: { get: (n: string) => (n === "content-length" && f.contentLength !== undefined ? String(f.contentLength) : null) },
            async blob() {
              return { size: f.size };
            },
          };
        },
        async delete(url: string) {
          const had = url in store;
          delete store[url];
          return had;
        },
      };
    },
  };
}

const kokoro = kokoroModel("q8");
const allKokoro = (over: Record<string, { size: number; contentLength?: number }> = {}) =>
  Object.fromEntries(kokoro.assets.map((a) => [a.url, over[a.url] ?? { size: 1000, contentLength: 1000 }]));

test("piper voice paths follow the voice library layout", () => {
  assert.equal(piperPath("en_US-lessac-medium"), "en/en_US/lessac/medium/en_US-lessac-medium");
  assert.ok(piperModel("en_GB-alan-medium").assets[1].url.endsWith("/en/en_GB/alan/medium/en_GB-alan-medium.onnx"));
});

test("a model with every file present and the right size is ready", async () => {
  const r = await checkModel(fakeCaches(allKokoro()), kokoro, 1);
  assert.equal(r.status, "ready");
  assert.equal(r.bytes, 4000);
});

test("nothing cached is not-downloaded, even if an old flag says otherwise", async () => {
  assert.equal((await checkModel(fakeCaches({}), kokoro)).status, "not-downloaded");
});

test("some files missing is reported, not ready", async () => {
  const files = allKokoro();
  delete files[kokoro.assets[3].url];
  assert.equal((await checkModel(fakeCaches(files), kokoro)).status, "missing-files");
});

test("a truncated or empty file is corrupt", async () => {
  const model = kokoro.assets[0].url;
  assert.equal((await checkModel(fakeCaches(allKokoro({ [model]: { size: 10, contentLength: 1000 } })), kokoro)).status, "corrupt");
  assert.equal((await checkModel(fakeCaches(allKokoro({ [model]: { size: 0 } })), kokoro)).status, "corrupt");
});

test("large files are trusted by recorded size without being read", async () => {
  const big = kokoro.assets[3].url;
  const caches = fakeCaches(allKokoro({ [big]: { size: 0, contentLength: 92_000_000 } }));
  const r = await checkModel(caches, kokoro);
  assert.equal(r.status, "ready");
  assert.equal(r.assets[3].bytes, 92_000_000);
});

test("no Cache Storage is storage-unavailable", async () => {
  assert.equal((await checkModel(null, kokoro)).status, "storage-unavailable");
});

test("repair deletes only damaged files and keeps valid ones", async () => {
  const bad = kokoro.assets[1].url;
  const caches = fakeCaches(allKokoro({ [bad]: { size: 5, contentLength: 1000 } }));
  const check = await checkModel(caches, kokoro);
  assert.equal(await repairModel(caches, check, kokoro), 1);
  assert.ok(!(bad in caches.files));
  assert.equal(Object.keys(caches.files).length, 3);
  assert.equal((await checkModel(caches, kokoro)).status, "missing-files");
});

test("removing one model leaves other models' files alone", async () => {
  const piper = piperModel("en_GB-alan-medium");
  const caches = fakeCaches({ ...allKokoro(), ...Object.fromEntries(piper.assets.map((a) => [a.url, { size: 10, contentLength: 10 }])) });
  await removeModel(caches, piper);
  assert.equal((await checkModel(caches, piper)).status, "not-downloaded");
  assert.equal((await checkModel(caches, kokoro)).status, "ready");
});
