// The one place that decides what a listener may use. Paid features will be
// gated here later (`can("…")`); today everything is free and isPro() is false.
//
// No payment provider is connected. When one is, isPro() must check a verified
// purchase — never a URL parameter or a localStorage flag alone.

export type Tier = "free" | "pro";

/** Which tier each feature needs. Everything is "free" until a decision is made. */
export const features = {
  studioVoices: "free",
  lightweightVoices: "free",
  prepareAhead: "free",
  perChapterVoices: "free",
  annotations: "free",
  exportNotes: "free",
  exportAudio: "free",
  collections: "free",
} as const satisfies Record<string, Tier>;

export type Feature = keyof typeof features;

/** Whether this listener has Pro. No payment provider yet, so never. */
export function isPro(): boolean {
  return false;
}

/** Whether a feature is available to this listener. */
export function can(feature: Feature): boolean {
  return features[feature] === "free" || isPro();
}
