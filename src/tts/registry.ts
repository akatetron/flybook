// What speech models Flybook can download, where their files live on this
// device, and whether those files are really there.
//
// The cached files are the source of truth. Earlier versions trusted a
// "downloaded" flag in localStorage; a flag can outlive its files (site data
// partly cleared, storage evicted), so readiness is now decided only by
// checking Cache Storage, and stale flags are cleared.

export type EngineId = "kokoro" | "piper";

export interface ModelAsset {
  /** Absolute URL; also the Cache Storage key. */
  url: string;
  /** Which Cache Storage cache holds it. */
  cache: string;
  /** Needed to speak at all (false for files fetched only when a voice is used). */
  required: boolean;
  /** Also used by another model (e.g. Kokoro's config and tokenizer), so its presence alone doesn't mean this model was downloaded. */
  shared?: boolean;
}

export interface ModelInfo {
  id: string;
  engine: EngineId;
  version: string;
  name: string;
  license: string;
  attribution: string;
  /** Rough download size for display; the server's sizes are used when known. */
  approxMB: number;
  assets: ModelAsset[];
}

export type ModelStatus =
  | "not-downloaded"
  | "downloading"
  | "verifying"
  | "ready"
  | "missing-files"
  | "corrupt"
  | "storage-unavailable";

export interface AssetCheck {
  url: string;
  present: boolean;
  bytes: number;
  /** Size the server sent when the file was downloaded, if recorded. */
  expectedBytes: number | null;
  ok: boolean;
}

export interface ModelCheck {
  id: string;
  status: ModelStatus;
  bytes: number;
  assets: AssetCheck[];
  checkedAt: number;
}

/** Minimal Cache Storage surface, so verification can be tested without a browser. */
export interface CacheLike {
  match(url: string): Promise<{ headers: { get(name: string): string | null }; blob(): Promise<{ size: number }> } | undefined>;
  delete(url: string): Promise<boolean>;
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

// ---------- Registry ----------

export const KOKORO_CACHE = "transformers-cache";
export const KOKORO_VOICE_CACHE = "kokoro-voices";
export const PIPER_CACHE = "flybook-piper-v1";

const KOKORO_REPO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const PIPER_REPO = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** "en_US-lessac-medium" -> "en/en_US/lessac/medium/en_US-lessac-medium" */
export function piperPath(voice: string): string {
  const [locale, name, quality] = voice.split("-");
  return `${locale.split("_")[0]}/${locale}/${name}/${quality}/${voice}`;
}

export function kokoroModel(precision: "q8" | "fp32"): ModelInfo {
  const file = precision === "q8" ? "onnx/model_quantized.onnx" : "onnx/model.onnx";
  return {
    id: `kokoro-82m-v1.0-${precision}`,
    engine: "kokoro",
    version: "1.0",
    name: precision === "q8" ? "Kokoro 82M (8-bit, phones and computers)" : "Kokoro 82M (full precision, computer GPU)",
    license: "Apache-2.0",
    attribution: "Kokoro-82M by hexgrad; ONNX export by onnx-community",
    approxMB: precision === "q8" ? 92 : 326,
    assets: [
      { url: `${KOKORO_REPO}/config.json`, cache: KOKORO_CACHE, required: true, shared: true },
      { url: `${KOKORO_REPO}/tokenizer.json`, cache: KOKORO_CACHE, required: true, shared: true },
      { url: `${KOKORO_REPO}/tokenizer_config.json`, cache: KOKORO_CACHE, required: true, shared: true },
      { url: `${KOKORO_REPO}/${file}`, cache: KOKORO_CACHE, required: true },
    ],
  };
}

/** One Kokoro voice: a small style file used with the shared model. */
export function kokoroVoiceAsset(voice: string): ModelAsset {
  return { url: `${KOKORO_REPO}/voices/${voice}.bin`, cache: KOKORO_VOICE_CACHE, required: true };
}

export function piperModel(voice: string): ModelInfo {
  const path = piperPath(voice);
  return {
    id: `piper:${voice}`,
    engine: "piper",
    version: "1",
    name: `Piper ${voice}`,
    // Each Piper voice has its own licence, set by its training data; see PIPER_LICENSES.
    license: PIPER_LICENSES[voice] ?? "Unverified — check the voice's model card",
    attribution: "Piper voices by the Rhasspy project (rhasspy/piper-voices)",
    approxMB: 63,
    assets: [
      { url: `${PIPER_REPO}/${path}.onnx.json`, cache: PIPER_CACHE, required: true },
      { url: `${PIPER_REPO}/${path}.onnx`, cache: PIPER_CACHE, required: true },
    ],
  };
}

/**
 * Licences of the Piper voices' training data, where we have checked them.
 * Voices not listed here are unverified and are labelled as such in the app.
 */
export const PIPER_LICENSES: Record<string, string> = {
  "en_US-lessac-medium": "Blizzard 2013 (Lessac) data — research use only, not for commercial use",
  "en_US-ryan-medium": "CC BY-NC-SA 4.0 — non-commercial",
};

// ---------- Verification ----------

const LARGE_BYTES = 20 * 1024 * 1024;

/** Checks one file: present, non-empty, and the size the server announced. */
export async function checkAsset(caches: CacheStorageLike, asset: ModelAsset): Promise<AssetCheck> {
  const cache = await caches.open(asset.cache);
  const hit = await cache.match(asset.url);
  if (!hit) return { url: asset.url, present: false, bytes: 0, expectedBytes: null, ok: false };
  const header = Number(hit.headers.get("content-length"));
  const expectedBytes = Number.isFinite(header) && header > 0 ? header : null;
  // Large model files are not read back just to measure them (that would load
  // ~90-330 MB into memory on a phone). Cache Storage only stores a response
  // once its whole body has arrived, so a recorded size is trusted for them.
  if (expectedBytes !== null && expectedBytes > LARGE_BYTES) {
    return { url: asset.url, present: true, bytes: expectedBytes, expectedBytes, ok: true };
  }
  let bytes = 0;
  try {
    bytes = (await hit.blob()).size;
  } catch {
    return { url: asset.url, present: true, bytes: 0, expectedBytes, ok: false };
  }
  const ok = bytes > 0 && (expectedBytes === null || expectedBytes === bytes);
  return { url: asset.url, present: true, bytes, expectedBytes, ok };
}

/** The real state of a model on this device. */
export async function checkModel(caches: CacheStorageLike | null, model: ModelInfo, now = Date.now()): Promise<ModelCheck> {
  if (!caches) return { id: model.id, status: "storage-unavailable", bytes: 0, assets: [], checkedAt: now };
  let assets: AssetCheck[];
  try {
    assets = await Promise.all(model.assets.map((a) => checkAsset(caches, a)));
  } catch {
    return { id: model.id, status: "storage-unavailable", bytes: 0, assets: [], checkedAt: now };
  }
  const bytes = assets.reduce((n, a) => n + a.bytes, 0);
  const required = assets.filter((_, i) => model.assets[i].required);
  const own = assets.filter((_, i) => model.assets[i].required && !model.assets[i].shared);
  let status: ModelStatus;
  // Files shared with another model don't count as this model being (partly) downloaded.
  if (required.every((a) => !a.present) || (own.length > 0 && own.every((a) => !a.present))) status = "not-downloaded";
  else if (required.some((a) => a.present && !a.ok)) status = "corrupt";
  else if (required.some((a) => !a.present)) status = "missing-files";
  else status = "ready";
  return { id: model.id, status, bytes, assets, checkedAt: now };
}

/** Deletes files that failed verification, so the engine downloads them again. Valid files are kept. */
export async function repairModel(caches: CacheStorageLike, check: ModelCheck, model: ModelInfo): Promise<number> {
  let removed = 0;
  for (const [i, a] of check.assets.entries()) {
    if (a.present && !a.ok) {
      const cache = await caches.open(model.assets[i].cache);
      if (await cache.delete(a.url)) removed++;
    }
  }
  return removed;
}

/** Deletes every file of a model (other models' files are untouched). */
export async function removeModel(caches: CacheStorageLike, model: ModelInfo): Promise<void> {
  for (const a of model.assets) {
    const cache = await caches.open(a.cache);
    await cache.delete(a.url);
  }
}

export const STATUS_LABEL: Record<ModelStatus, string> = {
  "not-downloaded": "Not downloaded",
  downloading: "Downloading",
  verifying: "Checking files",
  ready: "Ready",
  "missing-files": "Some files missing",
  corrupt: "Damaged files",
  "storage-unavailable": "Storage unavailable",
};
