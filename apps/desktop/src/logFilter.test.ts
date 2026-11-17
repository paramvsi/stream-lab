import { describe, expect, it, vi } from 'vitest';
import { filterLinesBounded, type FilterWorker } from './logFilter';

/** A fake worker: answers like the real one (filterLines), or never (a catastrophic pattern). */
const fake = (hang = false) => {
  const w: FilterWorker & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    postMessage(d) {
      if (hang) return;
      const { lines, pattern } = d as { lines: string[]; pattern: string };
      queueMicrotask(() =>
        w.onmessage?.({ data: { ok: true, lines: lines.filter((l) => l.includes(pattern)) } }),
      );
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
};

describe('OPS-01 · log filter off the UI thread, with a time limit', () => {
  it('a regex is filtered in a worker and the worker is closed after', async () => {
    const w = fake();
    expect(await filterLinesBounded(['a', 'b', 'ab'], 'a', true, () => w, 1_000)).toEqual(['a', 'ab']);
    expect(w.terminated).toBe(true);
  });

  it('a pattern that runs too long (catastrophic backtracking) is stopped: LOG-REGEX, the worker killed', async () => {
    vi.useFakeTimers();
    try {
      const w = fake(true);
      const p = filterLinesBounded(['aaaa!'], '(a+)+$', true, () => w, 1_000);
      vi.advanceTimersByTime(1_001);
      await expect(p).rejects.toMatchObject({
        code: 'LOG-REGEX',
        params: { reason: 'it takes too long to run' },
      });
      expect(w.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('plain text and an empty pattern need no worker', async () => {
    const make = vi.fn(() => fake());
    expect(await filterLinesBounded(['Warn x', 'info'], 'warn', false, make, 1_000)).toEqual(['Warn x']);
    expect(await filterLinesBounded(['a'], '', true, make, 1_000)).toEqual(['a']);
    expect(make).not.toHaveBeenCalled();
  });

  it('an invalid regex is LOG-REGEX before any worker', async () => {
    const make = vi.fn(() => fake());
    await expect(filterLinesBounded(['a'], '(', true, make, 1_000)).rejects.toMatchObject({
      code: 'LOG-REGEX',
    });
    expect(make).not.toHaveBeenCalled();
  });
});
