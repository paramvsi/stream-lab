import { describe, expect, it, vi } from 'vitest';
import { answerFilter, filterLinesBounded, type FilterWorker } from './logFilter';

/** A fake worker: answers like the real one (filterLines), or never (a catastrophic pattern). */
const fake = (hang = false) => {
  const w: FilterWorker & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(d) {
      if (hang) return;
      // The worker's own handling (answerFilter), so the message contract is the real one.
      queueMicrotask(() => w.onmessage?.({ data: answerFilter(d as { lines: string[]; pattern: string }) }));
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

  it('audit lf #2: the worker runs the regex (not a substring), and its own failure says ok:false with the reason', async () => {
    const w = fake();
    expect(
      await filterLinesBounded(['WARN a', 'x WARN', 'ERROR b'], '^(WARN|ERROR)', true, () => w, 1_000),
    ).toEqual(['WARN a', 'ERROR b']);
    expect(answerFilter({ lines: ['a'], pattern: '(' })).toMatchObject({ ok: false });
  });

  it('audit lf #1: a worker that fails (blocked, did not load, crashed) is LOG-FILTER-FAILED, not "your pattern is slow"', async () => {
    const w = fake(true);
    const p = filterLinesBounded(['a'], 'a+', true, () => w, 1_000);
    w.onerror?.({ message: 'Refused to create a worker' });
    await expect(p).rejects.toMatchObject({
      code: 'LOG-FILTER-FAILED',
      params: { reason: 'Refused to create a worker' },
    });
    expect(w.terminated).toBe(true);
  });

  it('audit lf2: a Worker that can not even be created (WebKit throws SecurityError on a CSP refusal) is LOG-FILTER-FAILED', async () => {
    const blocked = () => {
      throw Object.assign(new Error('Refused to create a worker'), { name: 'SecurityError' });
    };
    await expect(filterLinesBounded(['a'], 'a+', true, blocked, 1_000)).rejects.toMatchObject({
      code: 'LOG-FILTER-FAILED',
      params: { reason: 'Refused to create a worker' },
    });
  });

  it('audit lf2: an answer that can not be read (messageerror) is LOG-FILTER-FAILED at once, not "too slow"', async () => {
    const w = fake(true);
    const p = filterLinesBounded(['a'], 'a+', true, () => w, 1_000);
    w.onmessageerror?.({});
    await expect(p).rejects.toMatchObject({ code: 'LOG-FILTER-FAILED' });
    expect(w.terminated).toBe(true);
  });
});
