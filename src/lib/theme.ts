import type { Theme } from "./settings";

const LIGHT = "#f4efe2";
const DARK = "#0f1a14";

/** Light/dark follows the system unless the listener picked one. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  // index.html has one theme-color per system scheme; a fixed choice sets both.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const forLight = meta.media.includes("light");
    meta.content = theme === "system" ? (forLight ? LIGHT : DARK) : theme === "dark" ? DARK : LIGHT;
  }
}
