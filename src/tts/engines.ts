// One front door for both on-device voice engines. A voice id says which
// engine it belongs to ("piper:…" or a Kokoro id); everything else in the app
// just asks for speech in a voice.
import { kokoro, type Clip, type ModelState } from "./kokoro";
import { piper } from "./piper";
import { studioVoice } from "./voices";
import { models, modelForVoice } from "./modelStore";

const isPiper = (voice: string) => voice.startsWith("piper:");
const piperModel = (voice: string) => voice.slice("piper:".length);

export const tts = {
  generate(text: string, voice: string): Promise<Clip> {
    return isPiper(voice) ? piper.generate(text, piperModel(voice)) : kokoro.generate(text, voice);
  },
  async load(voice: string): Promise<void> {
    await (isPiper(voice) ? piper.load(piperModel(voice)) : kokoro.load());
    // Record what is really stored now (the engine may have just downloaded it).
    void models.verify(modelForVoice(voice, kokoro.info?.device === "webgpu" ? "fp32" : "q8"));
  },
  state(voice: string): ModelState {
    return isPiper(voice) ? piper.current : kokoro.current;
  },
  subscribe(fn: () => void): () => void {
    const a = kokoro.subscribe(fn);
    const b = piper.subscribe(fn);
    return () => {
      a();
      b();
    };
  },
  /** The voice's model files are on this device (checked in Cache Storage, not a flag). */
  wasDownloaded(voice: string): boolean {
    return models.isReady(voice);
  },
  crashedBefore(voice: string): boolean {
    return isPiper(voice) ? false : kokoro.crashedBefore();
  },
  realTimeFactor(voice: string): number | null {
    return isPiper(voice) ? piper.realTimeFactor : kokoro.realTimeFactor;
  },
  /** How the voice is running, e.g. "Piper · CPU · 2 cores". */
  label(voice: string): string | null {
    if (isPiper(voice)) return piper.label;
    const info = kokoro.info;
    if (!info) return null;
    return info.device === "webgpu"
      ? "Kokoro · GPU"
      : `Kokoro · CPU · ${info.threads} ${info.threads === 1 ? "core" : "cores"}`;
  },
  downloadLabel(voice: string): string {
    return isPiper(voice) ? "about 60 MB" : kokoro.downloadLabel;
  },
  engineName(voice: string): string {
    return studioVoice(voice).engine === "piper" ? "Natural voice" : "Studio voice";
  },
};
