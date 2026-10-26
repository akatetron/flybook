import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Settings } from "../lib/settings";
import { loadClip, saveClip } from "../lib/audioStore";
import { STUDIO_VOICES, type StudioVoice } from "../tts/voices";
import { tts } from "../tts/engines";
import { models, modelForVoice } from "../tts/modelStore";
import { STATUS_LABEL } from "../tts/registry";
import { systemSpeechSupported, useSystemVoices } from "../tts/system";

/** Sample passages for comparing voices (also the benchmark set in docs/voice-benchmark.md). */
export const SAMPLES = [
  { id: "prose", label: "Story", text: "It was a bright cold day in April, and the old lighthouse keeper climbed the stairs one last time." },
  { id: "numbers", label: "Numbers & dates", text: "On 3 March 2024, Dr. Patel paid $1,250.75 for 12 copies — about 8.5% more than in 1998." },
  { id: "legal", label: "Legal", text: "See Smith v. Jones, 410 U.S. 113, 115 (1973); cf. § 2(b)(iii) of the Act, as amended." },
  { id: "academic", label: "Academic", text: "Results (n = 42) were significant, e.g. p < 0.05; however, see Table 3 and refs. [4]–[7]." },
];

const PREVIEW_BOOK = (sample: string) => `__preview__:${sample}`;

function useModels() {
  return useSyncExternalStore(
    (fn) => models.subscribe(fn),
    () => models.version
  );
}

export function VoiceStudio({ settings, onSettings }: { settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  useModels();
  const [sample, setSample] = useState(SAMPLES[0].id);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef(false);
  const systemVoices = useSystemVoices();
  const text = SAMPLES.find((s) => s.id === sample)!.text;

  useEffect(() => () => {
    audio.current?.pause();
    if (systemSpeechSupported) speechSynthesis.cancel();
  }, []);

  /** Plays the sample in a voice: saved output if it was made before, otherwise the real engine makes it. */
  async function preview(v: StudioVoice): Promise<void> {
    setError(null);
    const key = PREVIEW_BOOK(sample);
    let blob = await loadClip(key, v.id, 0);
    if (!blob) {
      if (!models.isReady(v.id) && !confirm(`Previewing ${v.name} downloads its voice model (${tts.downloadLabel(v.id)}) to this device. Continue?`)) return;
      setBusy(v.id);
      try {
        const clip = await tts.generate(text, v.id);
        blob = clip.blob;
        URL.revokeObjectURL(clip.url);
        await saveClip(key, v.id, 0, blob, clip.seconds);
      } catch (e) {
        setError(`${v.name}: ${(e as Error).message}`);
        return;
      } finally {
        setBusy(null);
      }
    }
    const el = (audio.current ??= new Audio());
    const url = URL.createObjectURL(blob);
    el.src = url;
    el.playbackRate = settings.speed;
    setPlaying(v.id);
    await new Promise<void>((resolve) => {
      el.onended = el.onpause = () => resolve();
      el.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
    setPlaying(null);
  }

  async function playCompare() {
    stopRef.current = false;
    for (const id of compare) {
      if (stopRef.current) break;
      await preview(STUDIO_VOICES.find((v) => v.id === id)!);
    }
  }

  function stop() {
    stopRef.current = true;
    audio.current?.pause();
    if (systemSpeechSupported) speechSynthesis.cancel();
    setPlaying(null);
  }

  function previewSystem(voice: SpeechSynthesisVoice) {
    stop();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.rate = settings.speed;
    u.onend = u.onerror = () => setPlaying(null);
    setPlaying(voice.voiceURI);
    speechSynthesis.speak(u);
  }

  const toggleFavorite = (id: string) =>
    onSettings({ favorites: settings.favorites.includes(id) ? settings.favorites.filter((f) => f !== id) : [...settings.favorites, id] });
  const toggleCompare = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? [...c.slice(1), id] : [...c, id]));

  const sorted = [...STUDIO_VOICES].sort(
    (a, b) => Number(settings.favorites.includes(b.id)) - Number(settings.favorites.includes(a.id))
  );
  const groups: { title: string; note: string; voices: StudioVoice[] }[] = [
    {
      title: "Studio voices · Kokoro",
      note: "The most natural narration. One shared model (about 90 MB, or about 330 MB for the faster computer-GPU version) serves every Kokoro voice; each voice adds a file of about 0.5 MB.",
      voices: sorted.filter((v) => v.engine === "kokoro"),
    },
    {
      title: "Lightweight voices · Piper",
      note: "Smaller and faster on phones. Each voice is its own download of about 60 MB.",
      voices: sorted.filter((v) => v.engine === "piper"),
    },
  ];

  return (
    <div className="screen voices">
      <header className="screen-head">
        <h1>Voice Studio</h1>
        <p className="muted">Every voice runs on this device. Previews are real output from the voice, saved so they replay instantly.</p>
      </header>

      <div className="sample-picker" role="radiogroup" aria-label="Sample passage">
        {SAMPLES.map((s) => (
          <button key={s.id} role="radio" aria-checked={sample === s.id} className={`chip ${sample === s.id ? "active" : ""}`} onClick={() => setSample(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <blockquote className="sample-text">{text}</blockquote>

      <div className="compare-bar">
        <span className="muted small">
          {compare.length ? `Compare: ${compare.map((id) => STUDIO_VOICES.find((v) => v.id === id)!.name).join(", ")}` : "Tick up to three voices to hear them one after another."}
        </span>
        {compare.length > 1 && (
          <button className="btn small primary" onClick={playCompare} disabled={!!busy || !!playing}>
            Play in turn
          </button>
        )}
        {playing && (
          <button className="btn small" onClick={stop}>
            Stop
          </button>
        )}
      </div>
      {error && <p className="alert">{error}</p>}

      {groups.map((g) => (
        <section key={g.title} className="studio-group">
          <h2>{g.title}</h2>
          <p className="muted small">{g.note}</p>
          <ul className="voice-cards">
            {g.voices.map((v) => {
              const model = modelForVoice(v.id);
              const check = models.check(model.id);
              const ready = models.isReady(v.id);
              const isDefault = settings.engine === "studio" && settings.studioVoice === v.id;
              const fav = settings.favorites.includes(v.id);
              return (
                <li key={v.id} className={`voice-card ${isDefault ? "default" : ""}`}>
                  <div className="voice-card-head">
                    <strong>{v.name}</strong>
                    <button className={`star ${fav ? "on" : ""}`} onClick={() => toggleFavorite(v.id)} aria-pressed={fav} aria-label={fav ? `Unfavourite ${v.name}` : `Favourite ${v.name}`}>
                      ★
                    </button>
                  </div>
                  <p className="voice-card-note">{v.note}</p>
                  <p className="muted small">
                    {v.accent} English · {v.gender} · {v.engine === "kokoro" ? "Kokoro" : "Piper"}
                  </p>
                  <p className={`small model-state ${ready ? "ok" : ""}`}>
                    {ready
                      ? v.engine === "kokoro" && !models.kokoroVoiceCached(v.id)
                        ? "Model installed · voice file downloads on first use"
                        : "Installed on this device"
                      : `${check ? STATUS_LABEL[check.status] : "Checking…"} · ${tts.downloadLabel(v.id)}`}
                  </p>
                  <p className="muted tiny">Licence: {model.license}</p>
                  <div className="voice-card-actions">
                    <button className="btn small" onClick={() => (playing === v.id ? stop() : preview(v))} disabled={busy !== null && busy !== v.id}>
                      {busy === v.id ? "Making preview…" : playing === v.id ? "Stop" : "Preview"}
                    </button>
                    <button className="btn small primary" disabled={isDefault} onClick={() => onSettings({ engine: "studio", studioVoice: v.id })}>
                      {isDefault ? "Default" : "Use as default"}
                    </button>
                    <label className="compare-check">
                      <input type="checkbox" checked={compare.includes(v.id)} onChange={() => toggleCompare(v.id)} /> Compare
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="studio-group">
        <h2>Instant voices · this device</h2>
        <p className="muted small">
          Your browser's built-in voices start immediately, but quality varies, they can't be prepared ahead, and some may
          use an online service depending on your system — Flybook can't confirm that they work offline.
        </p>
        {!systemSpeechSupported ? (
          <p className="muted">This browser has no built-in speech.</p>
        ) : (
          <ul className="system-voices">
            {systemVoices.slice(0, 12).map((v) => (
              <li key={v.voiceURI}>
                <span>
                  {v.name} <span className="muted small">{v.lang}</span>
                </span>
                <span className="system-actions">
                  <button className="btn small" onClick={() => (playing === v.voiceURI ? stop() : previewSystem(v))}>
                    {playing === v.voiceURI ? "Stop" : "Preview"}
                  </button>
                  <button
                    className="btn small"
                    disabled={settings.engine === "system" && settings.systemVoice === v.voiceURI}
                    onClick={() => onSettings({ engine: "system", systemVoice: v.voiceURI })}
                  >
                    {settings.engine === "system" && settings.systemVoice === v.voiceURI ? "Default" : "Use as default"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
