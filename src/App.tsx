import { useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { useSettings } from "./lib/settings";

// Hash routing (#/book/<id>) so the phone's back button/gesture works and
// the site can live on any static host without rewrite rules.
function readRoute(): string | null {
  const m = location.hash.match(/^#\/book\/([\w-]+)$/);
  return m ? m[1] : null;
}

// True once we've pushed a history entry ourselves, so "back" never leaves the site.
let navigatedInApp = false;

export function App() {
  const [bookId, setBookId] = useState<string | null>(readRoute);
  const [settings, updateSettings] = useSettings();

  useEffect(() => {
    const onHash = () => setBookId(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (id: string) => {
    navigatedInApp = true;
    location.hash = `#/book/${id}`;
  };
  const back = () => {
    if (navigatedInApp) {
      navigatedInApp = false;
      history.back();
    } else location.hash = "";
  };

  return bookId ? (
    <Reader key={bookId} bookId={bookId} settings={settings} onSettings={updateSettings} onBack={back} />
  ) : (
    <Library onOpen={open} />
  );
}
