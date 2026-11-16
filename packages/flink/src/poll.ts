/**
 * FLINK_API.md "Concurrency" and "Polling defaults": at most 6 requests in flight per connection, polls share a
 * scheduler, polling pauses while the window is hidden, and failures are counted so the UI can say "stale"
 * (fleet: after 2) or show a banner (job list: after 3) with back-off.
 */
export const MAX_IN_FLIGHT = 6;

/** A per-connection gate: at most `max` calls run at once; the rest wait in order. */
export function limiter(max = MAX_IN_FLIGHT) {
  let running = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (running >= max) return;
    const go = queue.shift();
    if (go) {
      running++;
      go();
    }
  };
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() =>
          fn()
            .then(resolve, reject)
            .finally(() => {
              running--;
              next();
            }),
        );
        next();
      });
    },
    get inFlight() {
      return running;
    },
  };
}

export const POLL = {
  fleet: { everyMs: 15_000, staleAfter: 2 },
  jobs: { everyMs: 5_000, bannerAfter: 3 },
  job: { everyMs: 2_000 },
  checkpoints: { everyMs: 5_000 },
  logs: { everyMs: 2_000 },
} as const;

/** The wait before the next poll: the interval, doubled per failure in a row, at most 8×. */
export function nextDelay(everyMs: number, failures: number): number {
  return everyMs * 2 ** Math.min(Math.max(failures, 0), 3);
}

export interface Poller {
  stop(): void;
}
/**
 * Polls `fn` every `everyMs` (backing off on failures) while `visible()` is true; `onResult` gets each outcome
 * with the count of failures in a row. Time and visibility are injected (tests, and the desktop's window events).
 */
export function poll<T>(
  fn: () => Promise<T>,
  opts: {
    everyMs: number;
    onResult: (r: { ok: true; value: T } | { ok: false; error: unknown; failures: number }) => void;
    visible?: () => boolean;
    setTimer?: (f: () => void, ms: number) => unknown;
    clearTimer?: (t: unknown) => void;
  },
): Poller {
  const visible = opts.visible ?? (() => true);
  const setTimer = opts.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let failures = 0;
  let stopped = false;
  let timer: unknown = null;
  const tick = async () => {
    if (stopped) return;
    if (visible()) {
      try {
        const value = await fn();
        failures = 0;
        if (!stopped) opts.onResult({ ok: true, value });
      } catch (error) {
        failures++;
        if (!stopped) opts.onResult({ ok: false, error, failures });
      }
    }
    if (!stopped) timer = setTimer(() => void tick(), nextDelay(opts.everyMs, failures));
  };
  void tick();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
    },
  };
}
