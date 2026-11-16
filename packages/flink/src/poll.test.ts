import { describe, expect, it } from 'vitest';
import { limiter, nextDelay, poll } from './poll';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('FLINK_API concurrency: at most 6 requests in flight per connection', () => {
  it('the 7th waits until one finishes; order is kept', async () => {
    const l = limiter();
    const done: (() => void)[] = [];
    const started: number[] = [];
    const ps = Array.from({ length: 8 }, (_, i) =>
      l.run(
        () =>
          new Promise<number>((res) => {
            started.push(i);
            done.push(() => res(i));
          }),
      ),
    );
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(l.inFlight).toBe(6);
    done[0]!();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    done.forEach((d) => d());
    await flush();
    done.forEach((d) => d());
    expect(await Promise.all(ps)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('a failing call frees its slot too', async () => {
    const l = limiter(1);
    await expect(l.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await l.run(() => Promise.resolve(2))).toBe(2);
  });
});

describe('FLINK_API polling', () => {
  it('backs off on failures in a row (2×, 4×, at most 8×) and resets on success', () => {
    expect([0, 1, 2, 3, 9].map((f) => nextDelay(5000, f))).toEqual([5000, 10000, 20000, 40000, 40000]);
  });
  it('counts failures in a row, skips hidden windows, stops cleanly', async () => {
    const timers: { f: () => void; ms: number }[] = [];
    const results: string[] = [];
    let visible = true;
    const answers = [false, false, true];
    let calls = 0;
    const p = poll(() => (answers[calls++] ? Promise.resolve('ok') : Promise.reject(new Error('down'))), {
      everyMs: 15000,
      visible: () => visible,
      setTimer: (f, ms) => timers.push({ f, ms }),
      clearTimer: () => {},
      onResult: (r) => results.push(r.ok ? 'ok' : `fail ${r.failures}`),
    });
    await flush();
    timers.shift()!.f();
    await flush();
    expect(results).toEqual(['fail 1', 'fail 2']); // the fleet's "stale" point (2 failures)
    expect(timers[0]!.ms).toBe(60000);
    visible = false;
    timers.shift()!.f();
    await flush();
    expect(calls).toBe(2); // hidden: no request
    visible = true;
    timers.shift()!.f();
    await flush();
    expect(results.at(-1)).toBe('ok');
    expect(timers[0]!.ms).toBe(15000);
    p.stop();
    timers.shift()!.f();
    await flush();
    expect(calls).toBe(3);
  });
});

describe('audit of d5cc76c', () => {
  it('#5 a function that throws at once still frees its slot', async () => {
    const l = limiter(1);
    await expect(
      l.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    expect(l.inFlight).toBe(0);
    expect(await l.run(() => Promise.resolve(1))).toBe(1);
  });
  it('#4 a handler that throws is not counted as a cluster failure and does not stop polling', async () => {
    const timers: (() => void)[] = [];
    const seen: string[] = [];
    const rejections: unknown[] = [];
    const onRej = (e: unknown) => rejections.push(e);
    const proc = (
      globalThis as unknown as {
        process: {
          on(e: string, f: (x: unknown) => void): void;
          off(e: string, f: (x: unknown) => void): void;
        };
      }
    ).process;
    proc.on('unhandledRejection', onRej);
    poll(() => Promise.resolve('v'), {
      everyMs: 1000,
      setTimer: (f) => timers.push(f),
      clearTimer: () => {},
      onResult: (r) => {
        seen.push(r.ok ? 'ok' : `fail ${r.failures}`);
        throw new Error('render bug');
      },
    });
    await flush();
    timers.shift()!();
    await flush();
    await flush();
    proc.off('unhandledRejection', onRej);
    expect(seen).toEqual(['ok', 'ok']);
    expect(timers.length).toBe(1); // still polling
    expect(rejections.length).toBeGreaterThan(0); // the bug still surfaces
  });
});
