import { z } from 'zod';

/**
 * DATA-01: the pipeline's data generator (Data drawer, board W12). Sources with no uploaded file read from it.
 * ponytail: key skew and the built-in fraud patterns on the board are the fintech pack (DATA-05), not here.
 */
const SEED_MAX = 4_294_967_295; // the PRNG takes 32 bits: a wider range would alias (seed and seed + 2³²)
const pct = z.number().min(0).max(100);
export const GeneratorSettings = z.object({
  count: z.number().int().min(1).max(1_000_000),
  rate: z.number().int().min(1).max(10_000),
  seed: z.number().int().min(0).max(SEED_MAX),
  keys: z.number().int().min(1).max(1_000_000),
  outOfOrderPct: pct,
  latePct: pct,
  duplicatePct: pct,
  badRowsPct: pct,
});
export type GeneratorSettings = z.infer<typeof GeneratorSettings>;

export const DEFAULT_GENERATOR: GeneratorSettings = {
  count: 1000,
  rate: 50,
  seed: 42,
  keys: 20,
  outOfOrderPct: 10,
  latePct: 5,
  duplicatePct: 2,
  badRowsPct: 1,
};

/** Limits per field, stated once: the messages below read them, never zod's internals. */
const RULES: Record<
  keyof GeneratorSettings,
  { name: string; min: number; max: number; whole: boolean; unit: string }
> = {
  count: { name: 'Events', min: 1, max: 1_000_000, whole: true, unit: '' },
  rate: { name: 'Rate', min: 1, max: 10_000, whole: true, unit: '' },
  seed: { name: 'Seed', min: 0, max: SEED_MAX, whole: true, unit: '' },
  keys: { name: 'Distinct cards', min: 1, max: 1_000_000, whole: true, unit: '' },
  outOfOrderPct: { name: 'Out of order', min: 0, max: 100, whole: false, unit: ' %' },
  latePct: { name: 'Late', min: 0, max: 100, whole: false, unit: ' %' },
  duplicatePct: { name: 'Duplicates', min: 0, max: 100, whole: false, unit: ' %' },
  badRowsPct: { name: 'Malformed', min: 0, max: 100, whole: false, unit: ' %' },
};
const n = (x: number) => x.toLocaleString('en-US');

const issueOf = (f: keyof GeneratorSettings, v: unknown): string | null => {
  const r = RULES[f];
  if (typeof v !== 'number' || Number.isNaN(v)) return `Enter a number for ${r.name}`;
  if (v < r.min) return `${r.name} must be at least ${n(r.min)}${r.unit}`;
  if (v > r.max) return `${r.name} must be at most ${n(r.max)}${r.unit}`;
  if (r.whole && !Number.isInteger(v)) return `${r.name} must be a whole number`;
  return null;
};

/** GEN-INVALID reasons per field (the catalog message is "{reason}."). */
export function generatorIssues(
  g: Record<string, unknown>,
): { field: keyof GeneratorSettings; reason: string }[] {
  return (Object.keys(RULES) as (keyof GeneratorSettings)[]).flatMap((field) => {
    const reason = issueOf(field, g[field]);
    return reason ? [{ field, reason }] : [];
  });
}

/**
 * The settings a run uses and the drawer shows — the same function for both, so they never disagree. A stored
 * value that is invalid (hand-edited, older build) falls back to its default, field by field.
 */
export function effectiveGenerator(stored: unknown, seed: number): GeneratorSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const withSeed: Record<string, unknown> = { seed, ...s };
  return Object.fromEntries(
    (Object.keys(RULES) as (keyof GeneratorSettings)[]).map((f) => [
      f,
      issueOf(f, withSeed[f]) ? DEFAULT_GENERATOR[f] : withSeed[f],
    ]),
  ) as GeneratorSettings;
}
