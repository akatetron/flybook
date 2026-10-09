import Native, { type SystemVoice } from "../modules/flybook-native";
import * as Kokoro from "./kokoro";

let cached: Promise<SystemVoice[]> | null = null;

/** On-device voices, best first: the phone's language, then enhanced quality. */
export function getVoices(): Promise<SystemVoice[]> {
  cached ??= Native.getVoices()
    .then((all) => {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const lang = locale.split("-")[0];
      const score = (v: SystemVoice) =>
        (v.language.replace("_", "-") === locale ? 4 : 0) + (v.language.startsWith(lang) ? 2 : 0) + (v.enhanced ? 1 : 0);
      return all.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
    })
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}

/** Forget the list, e.g. after the user downloads a new voice in Settings. */
export function refreshVoices() {
  cached = null;
}

export async function defaultVoice(): Promise<SystemVoice | null> {
  return (await getVoices())[0] ?? null;
}

/** "en-US" -> "English (United States)" when the phone can name it. */
export function languageName(tag: string): string {
  try {
    const names = new Intl.DisplayNames(undefined, { type: "language" });
    return names.of(tag.replace("_", "-")) ?? tag;
  } catch {
    return tag;
  }
}

// ---------- Studio and phone voices together ----------


export interface Voice {
  id: string;
  name: string;
  detail: string;
  studio: boolean;
}

export function studioVoices(): Voice[] {
  return Kokoro.STUDIO_VOICES.map((v) => ({
    id: Kokoro.STUDIO_PREFIX + v.id,
    name: v.name,
    detail: `Studio · ${v.accent} ${v.gender.toLowerCase()}`,
    studio: true,
  }));
}

export async function phoneVoices(): Promise<Voice[]> {
  return (await getVoices()).map((v) => ({
    id: v.id,
    name: v.name,
    detail: languageName(v.language) + (v.enhanced ? " · enhanced" : ""),
    studio: false,
  }));
}

/** The saved voice if it's still usable, otherwise the best one available. */
export async function resolveVoice(saved: string | null): Promise<Voice | null> {
  const studio = studioVoices();
  if (saved && Kokoro.isStudio(saved) && Kokoro.isInstalled()) return studio.find((v) => v.id === saved) ?? studio[0];
  const phone = await phoneVoices().catch(() => [] as Voice[]);
  const found = phone.find((v) => v.id === saved);
  if (found) return found;
  if (Kokoro.isInstalled()) return studio[0];
  return phone[0] ?? null;
}
