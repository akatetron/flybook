import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sheet } from "./Sheet";
import { CheckIcon, PlayIcon, WaveIcon } from "./Icons";
import { kokoro } from "../tts/kokoro";
import { PREVIEW_TEXT, STUDIO_VOICES } from "../tts/voices";
import { systemSpeechSupported, useSystemVoices } from "../tts/system";
import type { Engine, Settings } from "../lib/settings";

export function useModelState() {
  return useSyncExternalStore(
    (fn) => kokoro.subscribe(fn),
    () => kokoro.current
  );
}

export function formatMB(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function ModelDownloadCard({ onStart }: { onStart?: () => void }) {
  const model = useModelState();
  if (model.phase === "ready") return null;
  if (model.phase === "loading") {
    const pct = model.total ? Math.round((model.loaded / model.total) * 100) : 0;
    return (
      <div className="card model-card">
        <p className="model-title">{kokoro.wasDownloaded() ? "Starting studio voices…" : "Downloading studio voices…"}</p>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="muted small">
          {model.total ? `${formatMB(model.loaded)} of ${formatMB(model.total)}` : "Preparing…"} · keep this page open
        </p>
      </div>
    );
  }
  return (
    <div className="card model-card">
      <p className="model-title">
        <WaveIcon width={18} height={18} /> Studio voices
      </p>
      <p className="muted small">
        {model.phase === "error"
          ? model.message
          : kokoro.wasDownloaded()
            ? "Ready on this device — loads in a few seconds."
            : `Human-like narration that runs entirely on your phone. One-time download of ${kokoro.downloadLabel}; works offline after that.`}
      </p>
      <button
        className="btn primary"
        onClick={() => {
          kokoro.load().catch(() => undefined);
          onStart?.();
        }}
      >
        {model.phase === "error" ? "Try again" : kokoro.wasDownloaded() ? "Load voices" : "Download voices"}
      </button>
    </div>
  );
}

interface VoiceSheetProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onBeforePreview: () => void;
}

export function VoiceSheet({ open, onClose, settings, onChange, onBeforePreview }: VoiceSheetProps) {
  const [tab, setTab] = useState<Engine>(settings.engine);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const systemVoices = useSystemVoices();
  const model = useModelState();

  useEffect(() => {
    if (open) setTab(settings.engine);
    if (!open) {
      previewAudio.current?.pause();
      if (systemSpeechSupported) speechSynthesis.cancel();
      setPreviewing(null);
    }
  }, [open, settings.engine]);

  async function previewStudio(id: string) {
    onBeforePreview();
    setPreviewing(id);
    // Create/unlock the element inside the tap so iOS allows playback later.
    const audio = (previewAudio.current ??= new Audio());
    try {
      const clip = await kokoro.generate(PREVIEW_TEXT, id);
      audio.src = clip.url;
      audio.onended = () => {
        URL.revokeObjectURL(clip.url);
        setPreviewing(null);
      };
      await audio.play();
    } catch {
      setPreviewing(null);
    }
  }

  function previewSystem(voice: SpeechSynthesisVoice) {
    onBeforePreview();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(PREVIEW_TEXT);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = settings.speed;
    u.onend = () => setPreviewing(null);
    setPreviewing(voice.voiceURI);
    speechSynthesis.speak(u);
  }

  const englishFirst = systemVoices.slice(0, 40);

  return (
    <Sheet title="Voice" open={open} onClose={onClose}>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === "studio"} className={tab === "studio" ? "on" : ""} onClick={() => setTab("studio")}>
          Studio voices
        </button>
        <button role="tab" aria-selected={tab === "system"} className={tab === "system" ? "on" : ""} onClick={() => setTab("system")}>
          Phone voices
        </button>
      </div>

      {tab === "studio" ? (
        <>
          <ModelDownloadCard />
          <p className="muted small hint">Studio voices read English. For other languages use a phone voice.</p>
          <ul className="voice-list">
            {STUDIO_VOICES.map((v) => {
              const selected = settings.engine === "studio" && settings.studioVoice === v.id;
              return (
                <li key={v.id} className={selected ? "selected" : ""}>
                  <button className="voice-main" onClick={() => onChange({ engine: "studio", studioVoice: v.id })}>
                    <span className={`avatar ${v.gender === "Female" ? "f" : "m"}`}>{v.name[0]}</span>
                    <span className="voice-text">
                      <span className="voice-name">
                        {v.name} {selected && <CheckIcon width={16} height={16} />}
                      </span>
                      <span className="muted small">
                        {v.gender} · {v.accent} · {v.note}
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-btn preview"
                    aria-label={`Preview ${v.name}`}
                    disabled={model.phase !== "ready" || previewing !== null}
                    onClick={() => previewStudio(v.id)}
                  >
                    {previewing === v.id ? <span className="spinner" /> : <PlayIcon width={16} height={16} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : !systemSpeechSupported || englishFirst.length === 0 ? (
        <p className="muted">This browser doesn't offer built-in voices. Use studio voices instead.</p>
      ) : (
        <>
          <p className="muted small hint">
            Instant, no download. Voices marked “Enhanced”, “Premium” or “Natural” sound best — on iPhone you can
            add more in Settings → Accessibility → Spoken Content → Voices.
          </p>
          <ul className="voice-list">
            {englishFirst.map((v) => {
              const selected =
                settings.engine === "system" && (settings.systemVoice === v.voiceURI || (!settings.systemVoice && v === englishFirst[0]));
              return (
                <li key={v.voiceURI} className={selected ? "selected" : ""}>
                  <button className="voice-main" onClick={() => onChange({ engine: "system", systemVoice: v.voiceURI })}>
                    <span className="avatar sys">{v.name[0]}</span>
                    <span className="voice-text">
                      <span className="voice-name">
                        {v.name} {selected && <CheckIcon width={16} height={16} />}
                      </span>
                      <span className="muted small">{v.lang}</span>
                    </span>
                  </button>
                  <button className="icon-btn preview" aria-label={`Preview ${v.name}`} onClick={() => previewSystem(v)}>
                    {previewing === v.voiceURI ? <span className="spinner" /> : <PlayIcon width={16} height={16} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
