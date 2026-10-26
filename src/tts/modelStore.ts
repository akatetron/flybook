// Live view of which speech models are really on this device. Checked against
// Cache Storage at startup and after every download, never against flags.
import { STUDIO_VOICES } from "./voices";
import {
  checkModel,
  kokoroModel,
  kokoroVoiceAsset,
  checkAsset,
  piperModel,
  removeModel,
  repairModel,
  type CacheStorageLike,
  type ModelCheck,
  type ModelInfo,
} from "./registry";

/** Flags from earlier versions; kept only as hints and cleared when wrong. */
const LEGACY_FLAGS = ["flybook:model-downloaded", "flybook:model-downloaded-gpu", "flybook:piper-downloaded"];

const browserCaches = (): CacheStorageLike | null =>
  typeof caches === "undefined" ? null : (caches as unknown as CacheStorageLike);

export function allModels(): ModelInfo[] {
  const piperVoices = STUDIO_VOICES.filter((v) => v.engine === "piper").map((v) => v.id.slice("piper:".length));
  return [kokoroModel("q8"), kokoroModel("fp32"), ...piperVoices.map(piperModel)];
}

/** The model a voice needs. Kokoro voices share one model per precision. */
export function modelForVoice(voice: string, precision: "q8" | "fp32" = "q8"): ModelInfo {
  return voice.startsWith("piper:") ? piperModel(voice.slice("piper:".length)) : kokoroModel(precision);
}

type Listener = () => void;

class ModelStore {
  private checks = new Map<string, ModelCheck>();
  private kokoroVoices = new Set<string>();
  private listeners = new Set<Listener>();
  private first: Promise<void> | null = null;
  version = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** Resolves once the first check of every model has finished. */
  ready(): Promise<void> {
    this.first ??= this.verifyAll();
    return this.first;
  }

  check(id: string): ModelCheck | undefined {
    return this.checks.get(id);
  }

  /** True only when every required file of the voice's model is present and intact. */
  isReady(voice: string): boolean {
    if (voice.startsWith("piper:")) return this.checks.get(modelForVoice(voice).id)?.status === "ready";
    return ["q8", "fp32"].some((p) => this.checks.get(kokoroModel(p as "q8" | "fp32").id)?.status === "ready");
  }

  /** The Kokoro voice's own style file is cached (needed to play it offline). */
  kokoroVoiceCached(voice: string): boolean {
    return this.kokoroVoices.has(voice);
  }

  async verify(model: ModelInfo): Promise<ModelCheck> {
    const result = await checkModel(browserCaches(), model);
    this.checks.set(model.id, result);
    this.emit();
    return result;
  }

  async verifyAll(): Promise<void> {
    await Promise.all(allModels().map((m) => this.verify(m)));
    const store = browserCaches();
    if (store) {
      await Promise.all(
        STUDIO_VOICES.filter((v) => v.engine === "kokoro").map(async (v) => {
          const c = await checkAsset(store, kokoroVoiceAsset(v.id)).catch(() => null);
          if (c?.ok) this.kokoroVoices.add(v.id);
          else this.kokoroVoices.delete(v.id);
        })
      );
    }
    this.reconcileFlags();
    this.emit();
  }

  /** Clears legacy "downloaded" flags that no longer match the files. */
  private reconcileFlags() {
    try {
      const kokoroReady = ["q8", "fp32"].some((p) => this.checks.get(kokoroModel(p as "q8" | "fp32").id)?.status === "ready");
      if (!kokoroReady) {
        localStorage.removeItem(LEGACY_FLAGS[0]);
        localStorage.removeItem(LEGACY_FLAGS[1]);
      }
      const listed: string[] = JSON.parse(localStorage.getItem(LEGACY_FLAGS[2]) ?? "[]");
      const kept = listed.filter((v) => this.isReady(`piper:${v}`));
      localStorage.setItem(LEGACY_FLAGS[2], JSON.stringify(kept));
    } catch {
      /* storage unavailable */
    }
  }

  /** Removes damaged files of a model so the next download replaces only those. */
  async repair(model: ModelInfo): Promise<number> {
    const store = browserCaches();
    const check = this.checks.get(model.id) ?? (await this.verify(model));
    if (!store) return 0;
    const removed = await repairModel(store, check, model);
    await this.verify(model);
    return removed;
  }

  async remove(model: ModelInfo): Promise<void> {
    const store = browserCaches();
    if (!store) return;
    await removeModel(store, model);
    if (model.engine === "kokoro") {
      // Voice style files are only useful with a Kokoro model.
      const otherReady = allModels().some((m) => m.engine === "kokoro" && m.id !== model.id && this.checks.get(m.id)?.status === "ready");
      if (!otherReady) {
        const cache = await store.open(kokoroVoiceAsset("x").cache);
        for (const v of STUDIO_VOICES.filter((s) => s.engine === "kokoro")) await cache.delete(kokoroVoiceAsset(v.id).url);
      }
    }
    await this.verifyAll();
  }
}

export const models = new ModelStore();
