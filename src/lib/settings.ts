// Small per-device preferences. localStorage can throw (private mode,
// blocked storage), so every access is guarded and falls back to defaults.
import { useCallback, useState } from "react";
import { DEFAULT_PHONE_VOICE, defaultVoice, isPhone, studioVoice } from "../tts/voices";

export type Engine = "studio" | "system";

export interface Settings {
  engine: Engine;
  studioVoice: string;
  systemVoice: string | null;
  speed: number;
  textSize: number;
}

const DEFAULTS: Settings = {
  engine: "studio",
  studioVoice: defaultVoice(),
  systemVoice: null,
  speed: 1,
  textSize: 19,
};

const KEY = "flybook:settings";
const MIGRATED = "flybook:phone-voice-migrated";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const saved: Settings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    // Phones that were set to a heavy Kokoro voice move to a fast Piper voice
    // once (Kokoro can't keep up on phones); they can still pick Kokoro again.
    if (isPhone() && studioVoice(saved.studioVoice).engine === "kokoro" && !localStorage.getItem(MIGRATED)) {
      localStorage.setItem(MIGRATED, "1");
      const next = { ...saved, studioVoice: DEFAULT_PHONE_VOICE };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    }
    return saved;
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in memory only */
      }
      return next;
    });
  }, []);
  return [settings, update] as const;
}
