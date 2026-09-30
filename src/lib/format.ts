export const WORDS_PER_MINUTE = 160;

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}
