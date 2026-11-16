/** Event time of the first generated event (fintech samples are around it). */
export const BASE_TIME = Date.parse('2026-11-15T12:00:00Z');

export type Event = Record<string, string | number | boolean | null>;

/** Deterministic PRNG (mulberry32; SIM-24: same seed, same events). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
