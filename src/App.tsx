import { useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { NavBar, type Tab } from "./components/NavBar";
import { StudyScreen } from "./components/StudyScreen";
import { VoiceStudio } from "./components/VoiceStudio";
import { StorageScreen } from "./components/StorageScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { PrivacyPage, TermsPage } from "./components/LegalPages";
import { useSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { VoiceNotice } from "./components/VoiceNotice";

// Hash routing so the phone's back button/gesture works and the site can live
// on any static host (GitHub Pages under /flybook/) without rewrite rules.
//   #/book/<id>[?at=<sentence>]   #/study   #/voices   #/storage   #/settings   #/privacy   #/terms
type Route = { tab: Tab } | { book: string; at: number | null } | { page: "privacy" | "terms" };

function readRoute(): Route {
  const book = location.hash.match(/^#\/book\/([\w-]+)(?:\?at=(\d+))?$/);
  if (book) return { book: book[1], at: book[2] ? Number(book[2]) : null };
  const page = location.hash.match(/^#\/(privacy|terms)$/)?.[1] as "privacy" | "terms" | undefined;
  if (page) return { page };
  const tab = location.hash.match(/^#\/(study|voices|storage|settings)$/)?.[1] as Tab | undefined;
  return { tab: tab ?? "library" };
}

// True once we've pushed a history entry ourselves, so "back" never leaves the site.
let navigatedInApp = false;

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [settings, updateSettings] = useSettings();

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const open = (id: string, at?: number) => {
    navigatedInApp = true;
    location.hash = `#/book/${id}${at !== undefined ? `?at=${at}` : ""}`;
  };
  const back = () => {
    if (navigatedInApp) {
      navigatedInApp = false;
      history.back();
    } else location.hash = "";
  };
  const go = (tab: Tab) => {
    location.hash = tab === "library" ? "" : `#/${tab}`;
  };

  if ("book" in route) {
    return (
      <>
        <UpdatePrompt />
        <VoiceNotice route={location.hash} />
        <Reader
        key={route.book}
        bookId={route.book}
        startAt={route.at}
        settings={settings}
        onSettings={updateSettings}
        onBack={back}
      />
      </>
    );
  }

  const tab: Tab = "tab" in route ? route.tab : "settings";
  return (
    <div className="shell">
      <UpdatePrompt />
      <VoiceNotice route={location.hash} />
      <NavBar tab={tab} onChange={go} />
      <div className="shell-main">
        {"page" in route && (route.page === "privacy" ? <PrivacyPage /> : <TermsPage />)}
        {"tab" in route && route.tab === "library" && <Library onOpen={open} />}
        {"tab" in route && route.tab === "study" && <StudyScreen onOpen={open} />}
        {"tab" in route && route.tab === "voices" && <VoiceStudio settings={settings} onSettings={updateSettings} />}
        {"tab" in route && route.tab === "storage" && <StorageScreen />}
        {"tab" in route && route.tab === "settings" && <SettingsScreen settings={settings} onSettings={updateSettings} />}
      </div>
    </div>
  );
}
