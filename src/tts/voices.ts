// Curated Kokoro voices — only the ones that sound good for long-form
// narration (grades from the Kokoro model card), best first.
export interface StudioVoice {
  id: string;
  name: string;
  gender: "Female" | "Male";
  accent: "American" | "British";
  note: string;
}

export const STUDIO_VOICES: StudioVoice[] = [
  { id: "af_heart", name: "Heart", gender: "Female", accent: "American", note: "Warm, most natural" },
  { id: "af_bella", name: "Bella", gender: "Female", accent: "American", note: "Bright, expressive" },
  { id: "af_nicole", name: "Nicole", gender: "Female", accent: "American", note: "Soft, close-mic" },
  { id: "bf_emma", name: "Emma", gender: "Female", accent: "British", note: "Clear, composed" },
  { id: "am_michael", name: "Michael", gender: "Male", accent: "American", note: "Calm, steady" },
  { id: "am_fenrir", name: "Fenrir", gender: "Male", accent: "American", note: "Deep, confident" },
  { id: "am_puck", name: "Puck", gender: "Male", accent: "American", note: "Lively, friendly" },
  { id: "bm_george", name: "George", gender: "Male", accent: "British", note: "Classic narrator" },
  { id: "bm_fable", name: "Fable", gender: "Male", accent: "British", note: "Storyteller" },
];

export const PREVIEW_TEXT = "It was a bright cold day in April, and the story was just beginning.";

export function studioVoice(id: string): StudioVoice {
  return STUDIO_VOICES.find((v) => v.id === id) ?? STUDIO_VOICES[0];
}
