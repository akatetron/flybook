import { useEffect, useState } from "react";
import { REMOVED_VOICES, studioVoice, takeVoiceNotice } from "../tts/voices";

/** One-time note when a voice the listener used was replaced for licence reasons. */
export function VoiceNotice({ route }: { route: string }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    // Checked on every navigation: books migrate their voice when opened.
    const found = takeVoiceNotice();
    if (found.length) setNames((n) => [...new Set([...n, ...found])]);
  }, [route]);
  if (!names.length) return null;
  const replacements = names.map((name) => {
    const id = Object.keys(REMOVED_VOICES).find((k) => REMOVED_VOICES[k].name === name)!;
    return `${name} → ${studioVoice(REMOVED_VOICES[id].replacement).name}`;
  });
  return (
    <div className="voice-notice" role="status">
      <p>
        <strong>Voice changed:</strong> {replacements.join(", ")}. {names.length > 1 ? "These voices were" : "This voice was"} removed
        because {names.length > 1 ? "their licences don't" : "its licence doesn't"} allow use in apps like Flybook. Your
        books, notes and places are unchanged; you can pick another voice in Voices.
      </p>
      <button className="btn small" onClick={() => setNames([])}>
        OK
      </button>
    </div>
  );
}
