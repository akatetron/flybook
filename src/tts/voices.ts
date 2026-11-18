// The voices Flybook offers, from two on-device engines (plus the browser's
// built-in "instant" voices, see system.ts):
//  - Studio (Kokoro): the most natural voices, but heavy — best on computers.
//  - Lightweight (Piper): small voices that run faster than real time on phones.
export type VoiceEngineKind = "piper" | "kokoro";

/**
 * Whether a voice's licence allows use in a paid product:
 *  - "yes": verified (licence and source in docs/LICENSES.md)
 *  - "unclear": no licence found that clearly allows it — never offered in a commercial build
 */
export type CommercialUse = "yes" | "unclear";

export interface VoiceLicense {
  /** Licence of the voice's training data / model, as published by its source. */
  name: string;
  /** Where the licence was checked. */
  url: string;
  commercial: CommercialUse;
}

export interface StudioVoice {
  id: string;
  engine: VoiceEngineKind;
  name: string;
  gender: "Female" | "Male";
  accent: "American" | "British";
  note: string;
  license: VoiceLicense;
}

const PIPER_CARD = (path: string) => `https://huggingface.co/rhasspy/piper-voices/blob/main/${path}/MODEL_CARD`;
const KOKORO_LICENSE: VoiceLicense = {
  name: "Apache-2.0",
  url: "https://huggingface.co/hexgrad/Kokoro-82M",
  commercial: "yes",
};

const piper = (model: string, name: string, gender: StudioVoice["gender"], accent: StudioVoice["accent"], note: string, license: Omit<VoiceLicense, "url">, cardPath: string) =>
  ({ id: `piper:${model}`, engine: "piper", name, gender, accent, note, license: { ...license, url: PIPER_CARD(cardPath) } }) as StudioVoice;
const kokoro = (id: string, name: string, gender: StudioVoice["gender"], accent: StudioVoice["accent"], note: string) =>
  ({ id, engine: "kokoro", name, gender, accent, note, license: KOKORO_LICENSE }) as StudioVoice;

/**
 * A build that may be sold (set VITE_COMMERCIAL_BUILD=true). It never offers
 * voices whose licence isn't verified for commercial use.
 */
export const COMMERCIAL_BUILD =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_COMMERCIAL_BUILD === "true";

/** Every voice Flybook knows about, with its licence (see docs/LICENSES.md). */
export const ALL_VOICES: StudioVoice[] = [
  piper("en_US-kristin-medium", "Kristin", "Female", "American", "Gentle, warm", { name: "Public domain (LibriVox recordings)", commercial: "yes" }, "en/en_US/kristin/medium"),
  piper("en_GB-cori-medium", "Cori", "Female", "British", "Crisp, composed", { name: "CC BY 4.0 (Hi-Fi TTS dataset, NVIDIA)", commercial: "yes" }, "en/en_GB/cori/medium"),
  piper("en_GB-alba-medium", "Alba", "Female", "British", "Soft Scottish", { name: "CC BY 4.0 (University of Edinburgh dataset)", commercial: "yes" }, "en/en_GB/alba/medium"),
  piper("en_US-joe-medium", "Joe", "Male", "American", "Relaxed, even", { name: "CC0 (OHF-Voice datasets)", commercial: "yes" }, "en/en_US/joe/medium"),
  piper("en_GB-northern_english_male-medium", "Northern", "Male", "British", "Northern English", { name: "CC BY-SA 4.0 (OpenSLR 83)", commercial: "yes" }, "en/en_GB/northern_english_male/medium"),
  kokoro("af_heart", "Heart", "Female", "American", "Warm, most natural"),
  kokoro("af_bella", "Bella", "Female", "American", "Bright, expressive"),
  kokoro("af_nicole", "Nicole", "Female", "American", "Soft, close-mic"),
  kokoro("bf_emma", "Emma", "Female", "British", "Clear, composed"),
  kokoro("am_michael", "Michael", "Male", "American", "Calm, steady"),
  kokoro("am_fenrir", "Fenrir", "Male", "American", "Deep, confident"),
  kokoro("am_puck", "Puck", "Male", "American", "Lively, friendly"),
  kokoro("bm_george", "George", "Male", "British", "Classic narrator"),
  kokoro("bm_fable", "Fable", "Male", "British", "Storyteller"),
];

/** The voices a build offers: a commercial build only those verified for commercial use. */
export function offeredVoices(commercial: boolean): StudioVoice[] {
  return ALL_VOICES.filter((v) => !commercial || v.license.commercial === "yes");
}

/** The voices this build offers. */
export const STUDIO_VOICES: StudioVoice[] = offeredVoices(COMMERCIAL_BUILD);

/**
 * Voices removed because their licences forbid (or don't clearly allow)
 * commercial use, and the closest licensed replacement. Saved choices are migrated (settings, books, chapters).
 */
export const REMOVED_VOICES: Record<string, { name: string; replacement: string }> = {
  "piper:en_US-lessac-medium": { name: "Lessac", replacement: "piper:en_US-kristin-medium" },
  "piper:en_US-ryan-medium": { name: "Ryan", replacement: "piper:en_US-joe-medium" },
  // No licence that clearly allows commercial use (Amy) / "all rights reserved" (Alan).
  "piper:en_US-amy-medium": { name: "Amy", replacement: "piper:en_US-kristin-medium" },
  "piper:en_GB-alan-medium": { name: "Alan", replacement: "piper:en_GB-northern_english_male-medium" },
};

/** A removed voice's replacement, or the id unchanged. */
export function migrateVoice(id: string): string {
  return REMOVED_VOICES[id]?.replacement ?? id;
}

const NOTICE_KEY = "flybook:voice-licence-notice";

/** Remembers that the listener's voice was replaced, so the app can say so once. */
export function noteVoiceMigrated(from: string) {
  try {
    const names: string[] = JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "[]");
    const name = REMOVED_VOICES[from]?.name;
    if (name && !names.includes(name)) localStorage.setItem(NOTICE_KEY, JSON.stringify([...names, name]));
  } catch {
    /* storage unavailable */
  }
}

/** Names of replaced voices the listener hasn't acknowledged yet. */
export function pendingVoiceNotice(): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** The listener has seen the notice (kept until then, so a reload can't lose it). */
export function clearVoiceNotice() {
  try {
    localStorage.setItem(NOTICE_KEY, "[]");
  } catch {
    /* storage unavailable */
  }
}

export const DEFAULT_PHONE_VOICE = "piper:en_US-kristin-medium";
export const DEFAULT_COMPUTER_VOICE = "af_heart";

export const PREVIEW_TEXT = "It was a bright cold day in April, and the story was just beginning.";

export function studioVoice(id: string): StudioVoice {
  const migrated = migrateVoice(id);
  return STUDIO_VOICES.find((v) => v.id === migrated) ?? STUDIO_VOICES.find((v) => v.id === DEFAULT_PHONE_VOICE) ?? STUDIO_VOICES[0];
}

export function isPhone(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

/** The voice to start with on this device. */
export function defaultVoice(): string {
  return isPhone() ? DEFAULT_PHONE_VOICE : DEFAULT_COMPUTER_VOICE;
}
