// Small per-device preferences. localStorage can throw (private mode,
// blocked storage), so every access is guarded and falls back to defaults.
import { useCallback, useState } from "react";

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
  studioVoice: "af_heart",
  systemVoice: null,
  speed: 1,
  textSize: 19,
};

const KEY = "flybook:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
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
