import { useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { NavBar, type Tab } from "./components/NavBar";
import { StudyScreen } from "./components/StudyScreen";
import { VoiceStudio } from "./components/VoiceStudio";
import { StorageScreen } from "./components/StorageScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { useSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";

// Hash routing so the phone's back button/gesture works and the site can live
// on any static host (GitHub Pages under /flybook/) without rewrite rules.
//   #/book/<id>[?at=<sentence>]   #/study   #/voices   #/storage   #/settings
type Route = { tab: Tab } | { book: string; at: number | null };

function readRoute(): Route {
  const book = location.hash.match(/^#\/book\/([\w-]+)(?:\?at=(\d+))?$/);
  if (book) return { book: book[1], at: book[2] ? Number(book[2]) : null };
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
      <Reader
        key={route.book}
        bookId={route.book}
        startAt={route.at}
        settings={settings}
        onSettings={updateSettings}
        onBack={back}
      />
    );
  }

  return (
    <div className="shell">
      <NavBar tab={route.tab} onChange={go} />
      <div className="shell-main">
        {route.tab === "library" && <Library onOpen={open} />}
        {route.tab === "study" && <StudyScreen onOpen={open} />}
        {route.tab === "voices" && <VoiceStudio settings={settings} onSettings={updateSettings} />}
        {route.tab === "storage" && <StorageScreen />}
        {route.tab === "settings" && <SettingsScreen settings={settings} onSettings={updateSettings} />}
      </div>
    </div>
  );
}
