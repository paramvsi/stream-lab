import { versionSupported } from './endpoints/config';

/**
 * CONN-07 / board C05: what works on a cluster, by its Flink version. The bands and the table are the board's.
 * ponytail: shown as a table only for now; hiding a "no" feature on the cluster pages (CONN-FEATURE-VERSION) comes
 * with those pages (M7).
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/rest_api/ (per-version endpoints)
 */
export type Band = 'old' | '1.20' | '2.0' | '2.3';
export type CapSupport = 'yes' | 'partial' | 'no';

export const BANDS: { band: Band; label: string }[] = [
  { band: 'old', label: 'Older than 1.20 (best effort)' },
  { band: '1.20', label: '1.20' },
  { band: '2.0', label: '2.0–2.2' },
  { band: '2.3', label: '2.3+' },
];

export const CAPABILITIES: { id: string; label: string; support: Record<Band, CapSupport> }[] = [
  {
    id: 'jobs',
    label: 'Jobs, checkpoints, exceptions',
    support: { old: 'yes', '1.20': 'yes', '2.0': 'yes', '2.3': 'yes' },
  },
  {
    id: 'stop',
    label: 'Stop with savepoint, drain',
    support: { old: 'yes', '1.20': 'yes', '2.0': 'yes', '2.3': 'yes' },
  },
  { id: 'flame', label: 'Flame graphs', support: { old: 'yes', '1.20': 'yes', '2.0': 'yes', '2.3': 'yes' } },
  { id: 'profiler', label: 'Profiler', support: { old: 'no', '1.20': 'yes', '2.0': 'yes', '2.3': 'yes' } },
  {
    id: 'rescale',
    label: 'Rescale (adaptive scheduler)',
    support: { old: 'partial', '1.20': 'yes', '2.0': 'yes', '2.3': 'yes' },
  },
  {
    id: 'applications',
    label: 'Applications tab',
    support: { old: 'no', '1.20': 'no', '2.0': 'no', '2.3': 'yes' },
  },
  {
    id: 'rescales',
    label: 'Rescales history',
    support: { old: 'no', '1.20': 'no', '2.0': 'no', '2.3': 'yes' },
  },
  {
    id: 'sqlv2',
    label: 'SQL Gateway REST v2 (row format)',
    support: { old: 'partial', '1.20': 'yes', '2.0': 'yes', '2.3': 'yes' },
  },
];

/**
 * The band a version belongs to ("v2.3.0", "2.10.1", "1.18.1-SNAPSHOT" all read); "unknown" when it does not start
 * with major.minor (a build without its version, e.g. "<unknown>"; "1"; " 1.18"): not called old.
 */
/** A version Stream Lab can read: major.minor at the start, an optional "v". */
export const READABLE = /^v?\d+\.\d+/i;

export function bandOf(version: string): Band | 'unknown' {
  // The same rule as Test connection's "is there a version" (testConnection.ts): one cluster, one answer.
  if (!READABLE.test(version)) return 'unknown';
  if (!versionSupported(version)) return 'old';
  const [maj = 0, min = 0] = version
    .replace(/^v/i, '')
    .split('.')
    .map((x) => Number.parseInt(x, 10) || 0);
  if (maj === 1) return '1.20';
  if (maj === 2 && min < 3) return '2.0';
  return '2.3';
}
