// The voices Flybook offers, from two on-device engines:
//  - Piper: small neural voices that run faster than real time on phones.
//  - Kokoro: the most natural voices, but heavy — best on computers.
export type VoiceEngineKind = "piper" | "kokoro";

export interface StudioVoice {
  id: string;
  engine: VoiceEngineKind;
  name: string;
  gender: "Female" | "Male";
  accent: "American" | "British";
  note: string;
}

const piper = (model: string, name: string, gender: StudioVoice["gender"], accent: StudioVoice["accent"], note: string) =>
  ({ id: `piper:${model}`, engine: "piper", name, gender, accent, note }) as StudioVoice;
const kokoro = (id: string, name: string, gender: StudioVoice["gender"], accent: StudioVoice["accent"], note: string) =>
  ({ id, engine: "kokoro", name, gender, accent, note }) as StudioVoice;

export const STUDIO_VOICES: StudioVoice[] = [
  piper("en_US-lessac-medium", "Lessac", "Female", "American", "Clear, expressive"),
  piper("en_US-amy-medium", "Amy", "Female", "American", "Bright, friendly"),
  piper("en_US-kristin-medium", "Kristin", "Female", "American", "Gentle, warm"),
  piper("en_GB-cori-medium", "Cori", "Female", "British", "Crisp, composed"),
  piper("en_GB-alba-medium", "Alba", "Female", "British", "Soft Scottish"),
  piper("en_US-ryan-medium", "Ryan", "Male", "American", "Warm narrator"),
  piper("en_US-joe-medium", "Joe", "Male", "American", "Relaxed, even"),
  piper("en_GB-alan-medium", "Alan", "Male", "British", "Classic, calm"),
  piper("en_GB-northern_english_male-medium", "Northern", "Male", "British", "Northern English"),
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

export const DEFAULT_PHONE_VOICE = "piper:en_US-lessac-medium";
export const DEFAULT_COMPUTER_VOICE = "af_heart";

export const PREVIEW_TEXT = "It was a bright cold day in April, and the story was just beginning.";

export function studioVoice(id: string): StudioVoice {
  return STUDIO_VOICES.find((v) => v.id === id) ?? STUDIO_VOICES[0];
}

export function isPhone(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

/** The voice to start with on this device. */
export function defaultVoice(): string {
  return isPhone() ? DEFAULT_PHONE_VOICE : DEFAULT_COMPUTER_VOICE;
}
