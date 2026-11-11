import { CoffeeButton } from "./Support";

export type Tab = "library" | "study" | "voices" | "storage" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "library", label: "Library", icon: "M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Zm0 0a2 2 0 0 1 2-2h12" },
  { id: "study", label: "Study", icon: "M6 3h12v18l-6-4-6 4V3Z" },
  { id: "voices", label: "Voices", icon: "M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" },
  { id: "storage", label: "Storage", icon: "M3 13h18v6H3v-6Zm2-8h14l2 8H3l2-8Zm2 11h2" },
  { id: "settings", label: "Settings", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" },
];

function Brand() {
  return (
    <a className="nav-brand" href="#" aria-label="Flybook home">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4" />
      </svg>
      <span>Flybook</span>
    </a>
  );
}

/** Top bar with tabs on wide screens; a bottom tab bar on phones. */
export function NavBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <header className="navbar">
      <Brand />
      <nav className="nav-tabs" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={`nav-item ${tab === t.id ? "on" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => onChange(t.id)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="nav-end">
        <CoffeeButton compact />
      </div>
    </header>
  );
}
