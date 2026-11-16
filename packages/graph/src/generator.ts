import { z } from 'zod';

/**
 * DATA-01: the pipeline's data generator (Data drawer, board W12). Sources with no uploaded file read from it.
 * ponytail: key skew and the built-in fraud patterns on the board are the fintech pack (DATA-05), not here.
 */
const pct = z.number().min(0).max(100);
export const GeneratorSettings = z.object({
  count: z.number().int().min(1).max(1_000_000),
  rate: z.number().int().min(1).max(10_000),
  seed: z.number().int(),
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

const NAMES: Record<keyof GeneratorSettings, string> = {
  count: 'Events',
  rate: 'Rate',
  seed: 'Seed',
  keys: 'Distinct cards',
  outOfOrderPct: 'Out of order',
  latePct: 'Late',
  duplicatePct: 'Duplicates',
  badRowsPct: 'Malformed',
};
const n = (x: number) => x.toLocaleString('en-US');

/** GEN-INVALID reasons per field (the catalog message is "{reason}."). */
export function generatorIssues(
  g: Record<string, unknown>,
): { field: keyof GeneratorSettings; reason: string }[] {
  const r = GeneratorSettings.safeParse(g);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const field = i.path[0] as keyof GeneratorSettings;
    const b = i as unknown as { minimum?: number; maximum?: number };
    const name = NAMES[field] ?? String(field);
    const reason =
      i.code === 'too_small'
        ? `${name} must be at least ${n(b.minimum!)}`
        : i.code === 'too_big'
          ? `${name} must be at most ${n(b.maximum!)}${field.endsWith('Pct') ? ' %' : ''}`
          : `${name} must be a whole number`;
    return { field, reason };
  });
}
