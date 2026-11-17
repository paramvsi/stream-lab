/** The worker's whole job, as a pure function (the worker and the tests both use it: one message contract). */
export type FilterRequest = { lines: string[]; pattern: string };
export type FilterAnswer = { ok: true; lines: string[] } | { ok: false; reason: string };

export function answerFilter({ lines, pattern }: FilterRequest): FilterAnswer {
  try {
    const re = new RegExp(pattern); // no flags: test() keeps no lastIndex between lines (as filterLines)
    return { ok: true, lines: lines.filter((l) => re.test(l)) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
