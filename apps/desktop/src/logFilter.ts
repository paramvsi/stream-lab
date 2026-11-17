import { AppError } from '@sl/errors';
import { filterLines } from '@sl/flink';

/** The part of a Worker this needs (a fake in tests: jsdom has none). */
export interface FilterWorker {
  postMessage(data: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  /** Blocked (CSP), failed to load, or crashed: the app's fault, not the pattern's. */
  onerror: ((e: { message?: string }) => void) | null;
  /** An answer that could not be read (structured clone failed). */
  onmessageerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export { answerFilter } from './logFilterCore';
import type { FilterAnswer } from './logFilterCore';

/** The real one: a module worker running filterLines (./logFilter.worker.ts). */
export const makeFilterWorker = (): FilterWorker =>
  new Worker(new URL('./logFilter.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as FilterWorker;

/** How long a regex filter may run before it is stopped (a catastrophic pattern would block for good). */
export const FILTER_LIMIT_MS = 2_000;

/**
 * OPS-01 / D18 filter, never on the UI thread for a regex: a user pattern with catastrophic backtracking ("(a+)+$")
 * can run for seconds per line. The regex runs in a worker, which is killed past `limitMs`: LOG-REGEX ("it takes
 * too long to run"). An invalid pattern is LOG-REGEX before any worker; plain text and an empty pattern are cheap
 * and run here.
 */
export async function filterLinesBounded(
  lines: readonly string[],
  pattern: string,
  regex: boolean,
  makeWorker: () => FilterWorker = makeFilterWorker,
  limitMs = FILTER_LIMIT_MS,
): Promise<string[]> {
  if (!regex || !pattern) return filterLines(lines, pattern, regex);
  filterLines([], pattern, true); // throws LOG-REGEX for an invalid pattern (it compiles it), before any worker
  const failed = (reason: string, cause?: unknown) => new AppError('LOG-FILTER-FAILED', { reason }, cause);
  let w: FilterWorker;
  try {
    w = makeWorker(); // WebKit throws here (SecurityError) when a CSP refuses the worker
  } catch (e) {
    throw failed(e instanceof Error ? e.message : String(e), e);
  }
  return new Promise<string[]>((resolve, reject) => {
    const t = setTimeout(() => {
      w.terminate();
      reject(new AppError('LOG-REGEX', { reason: 'it takes too long to run' }));
    }, limitMs);
    w.onmessage = (e) => {
      clearTimeout(t);
      w.terminate();
      const d = e.data as FilterAnswer;
      if (d.ok) resolve(d.lines);
      else reject(new AppError('LOG-REGEX', { reason: d.reason }));
    };
    w.onerror = (e) => {
      clearTimeout(t);
      w.terminate();
      reject(failed(e.message || 'the search could not start', e));
    };
    w.onmessageerror = (e) => {
      clearTimeout(t);
      w.terminate();
      reject(failed('its answer could not be read', e));
    };
    w.postMessage({ lines, pattern });
  });
}
