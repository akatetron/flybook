// The phone's built-in voices (Web Speech API). Instant and offline, and on
// recent iPhones/Android many of them are neural "enhanced" voices.
import { useEffect, useState } from "react";

export const systemSpeechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

/** Higher is better: prefer neural/enhanced voices, then local ones. */
function score(v: SpeechSynthesisVoice): number {
  let s = 0;
  if (/natural|neural|premium|enhanced|siri|online|wavenet/i.test(v.name)) s += 10;
  if (/google/i.test(v.name)) s += 5;
  if (v.lang.toLowerCase().startsWith("en")) s += 3;
  if (v.default) s += 1;
  // Novelty voices on Apple devices read books very badly.
  if (/albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i.test(v.name)) s -= 20;
  return s;
}

export function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

export function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    systemSpeechSupported ? rankVoices(speechSynthesis.getVoices()) : []
  );
  useEffect(() => {
    if (!systemSpeechSupported) return;
    const update = () => setVoices(rankVoices(speechSynthesis.getVoices()));
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

export function findSystemVoice(uri: string | null): SpeechSynthesisVoice | null {
  if (!systemSpeechSupported) return null;
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.voiceURI === uri) ?? rankVoices(voices)[0] ?? null;
}
