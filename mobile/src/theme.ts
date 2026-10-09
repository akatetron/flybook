// Forest & Gold, matching the website.
export const colors = {
  bg: "#0b1510",
  surface: "#12231c",
  surfaceHigh: "#16302a",
  border: "#244238",
  text: "#efeadc",
  muted: "#9fb3a8",
  gold: "#e9c770",
  onGold: "#0b1510",
  danger: "#e88b7a",
};

export const WORDS_PER_MINUTE = 160;

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
