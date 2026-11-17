/** Shared number and time words for the job pages (boards D08, D12). */
export const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
/** Board D08 "started 6 days ago": whole minutes, hours or days, in words. */
export const ago = (ms: number) =>
  ms < 3_600_000
    ? `${plural(Math.max(1, Math.floor(ms / 60_000)), 'minute')} ago`
    : ms < 86_400_000
      ? `${plural(Math.floor(ms / 3_600_000), 'hour')} ago`
      : `${plural(Math.floor(ms / 86_400_000), 'day')} ago`;

/** "820 ms", "3.4 s", "2 min 5 s": rounded first, so 59.95 s is "1 min 0 s", never "60.0 s" or "1 min 60 s". */
export const duration = (ms: number) => {
  if (ms < 999.5) return `${Math.round(ms)} ms`;
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)} s`;
  const s = Math.round(ms / 1_000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};
/** "500 B", "220 MB", "1.4 GB" (binary units, as Flink's own UI); a size Flink did not send is "—", not 0. */
export const size = (b: number | undefined) => {
  if (b === undefined) return '—';
  if (b < 1024) return `${Math.round(b)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  // Shown as whole KB / MB, one decimal from GB: carry when the shown value would read 1024.
  const shown = (v: number, i: number) => (i >= 2 ? Math.round(v * 10) / 10 : Math.round(v));
  let v = b / 1024;
  let i = 0;
  while (i < units.length - 1 && shown(v, i) >= 1024) {
    v /= 1024;
    i++;
  }
  return i >= 2 ? `${v.toFixed(1)} ${units[i]}` : `${Math.round(v)} ${units[i]}`;
};
/** Board D08 KPI note "2 min ago": the short form. */
export const shortAgo = (ms: number) =>
  ms < 3_600_000
    ? `${Math.max(1, Math.floor(ms / 60_000))} min ago`
    : ms < 86_400_000
      ? `${Math.floor(ms / 3_600_000)} h ago`
      : `${Math.floor(ms / 86_400_000)} d ago`;
