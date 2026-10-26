import type { Settings, Theme } from "../lib/settings";

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Match device" },
  { id: "light", label: "Paper" },
  { id: "dark", label: "Night" },
];

export function SettingsScreen({ settings, onSettings }: { settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  return (
    <div className="screen settings">
      <header className="screen-head">
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h2>Appearance</h2>
        <div className="chip-grid" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={settings.theme === t.id} className={`chip ${settings.theme === t.id ? "active" : ""}`} onClick={() => onSettings({ theme: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="size-row">
          <span>Reading text size</span>
          <input type="range" min={15} max={28} value={settings.textSize} onChange={(e) => onSettings({ textSize: Number(e.target.value) })} aria-label="Reading text size" />
          <span className="muted small">{settings.textSize}px</span>
        </label>
      </section>

      <section className="card">
        <h2>Playback</h2>
        <p className="muted small">Default speed</p>
        <div className="chip-grid" role="radiogroup" aria-label="Default speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={settings.speed === s} className={`chip ${settings.speed === s ? "active" : ""}`} onClick={() => onSettings({ speed: s })}>
              {s}×
            </button>
          ))}
        </div>
        <p className="muted small">
          Voices are chosen in <a href="#/voices">Voice Studio</a>. Each document remembers the voice you pick while
          reading it.
        </p>
      </section>

      <section className="card">
        <h2>Research and legal documents</h2>
        <label className="toggle">
          <input type="checkbox" checked={settings.skipCitations} onChange={(e) => onSettings({ skipCitations: e.target.checked })} />
          <span>
            Don't read citations aloud
            <span className="muted small"> — numeric ones like [12] and author–year ones like (Smith, 2020). Legal case citations are always read.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.skipReferences} onChange={(e) => onSettings({ skipReferences: e.target.checked })} />
          <span>
            Skip reference lists
            <span className="muted small"> — sections headed References, Bibliography or Works Cited are passed over when playing through (you can still open and play them).</span>
          </span>
        </label>
        <p className="muted small">
          These change only what is spoken: the text, your notes and exports keep everything. They apply to sentences
          prepared after the change; delete a document's prepared audio in Storage to redo older ones.
        </p>
      </section>

      <section className="card">
        <h2>Privacy</h2>
        <ul className="plain-list small">
          <li>Your documents, notes, highlights and generated audio stay in this browser. Flybook has no server and no account.</li>
          <li>
            Flybook's network requests are: the app itself (GitHub Pages), its typefaces (Google Fonts), and — only when you
            use a voice — that voice's model files from Hugging Face (huggingface.co). No document text, notes or audio are
            sent anywhere.
          </li>
          <li>There is no analytics or tracking.</li>
          <li>
            Built-in "instant" voices are provided by your browser or operating system, which may process speech in its own
            way.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>About</h2>
        <p className="small">
          Voices: Kokoro-82M (Apache-2.0) and Piper voices (licences vary by voice — shown in Voice Studio). PDF reading:
          pdf.js (Apache-2.0). Kokoro's pronunciation step uses espeak-ng (GPL-3.0) through the phonemizer package.
        </p>
      </section>
    </div>
  );
}
