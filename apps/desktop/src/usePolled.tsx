import { AppError, ErrorBanner } from '@sl/errors';
import { limiter, nextDelay, poll, POLL, type Connection, type FlinkHttp } from '@sl/flink';
import { Button, useToast } from '@sl/ui';
import { RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { shortAddress } from './Connections';

/**
 * Codes that mean the host can not be reached at all: the job poll's banner says those. A timeout or a reset
 * (CONN-IO) can hit one large response while small ones succeed, so on the exceptions read they are its own.
 */
export const HOST_DOWN = new Set([
  'CONN-DNS',
  'CONN-REFUSED',
  'CONN-TLS-UNTRUSTED',
  'CONN-CERT-CHANGED',
  'CONN-PROXY',
  'CONN-SSH-AUTH',
  'CONN-SSH-HOSTKEY',
  'CONN-K8S-CONTEXT',
  'CONN-OFFLINE',
]);

/**
 * One limiter per connection, shared by every poll on it (FLINK_API: at most 6 requests in flight per connection;
 * polls share a scheduler). A screen with several polls (job, checkpoints, exceptions, backpressure) stays under it.
 * ponytail: never dropped; one small object per connection ever opened.
 */
const gates = new WeakMap<object, Map<string, ReturnType<typeof limiter>>>();
/** Per transport (the app passes one for every screen) and connection: one cluster, one budget. */
const gateFor = (transport: object, id: string) => {
  let byConn = gates.get(transport);
  if (!byConn) gates.set(transport, (byConn = new Map()));
  let g = byConn.get(id);
  if (!g) byConn.set(id, (g = limiter()));
  return g;
};

/**
 * One screen's polled read of a connection, with ERRORS_AND_ALERTS §4: 1 failure silent, 2 → stale (the data
 * stays), 3 → CONN-LOST / API-TIMEOUT over the kept data (an API answer keeps its own code), back-off, paused while
 * hidden, "Back in contact" once on recovery. Before any data, the error itself with a Retry of our own.
 * The banner holds focus sometimes: when it goes, focus goes to `heading`, never to <body>.
 */
export function usePolled<T>(
  c: Connection,
  transport: (c: Connection) => FlinkHttp,
  read: (http: FlinkHttp, conn: string, timeoutMs: number) => Promise<T>,
  heading: RefObject<HTMLHeadingElement | null>,
  everyMs: number = POLL.jobs.everyMs,
  /** A second poll on one screen (its banner not shown): no "Back in contact" of its own, so the screen says it once. */
  opts: { quiet?: boolean; restartOn?: string | number | boolean } = {},
): {
  value: T | null;
  error: AppError | null;
  /** Failures in a row (across Retries). */
  failures: number;
  /** Ask again now (a fresh poller). */
  retry: () => void;
  stale: boolean;
  since: string;
  banner: ReactNode;
} {
  const toast = useToast();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  /** Failures in a row, across Retries (a Retry starts a new poller, but the cluster may still be down). */
  const [failures, setFailures] = useState(0);
  const fails = useRef(0);
  /** The poller's own count (a Retry restarts it, and with it the back-off): the wait the banner names. */
  const [pollFails, setPollFails] = useState(0);
  /** Data was on screen when the 3rd failure came: CONN-LOST / API-TIMEOUT was shown (its recovery toasts). */
  const lost = useRef(false);
  const hasValue = useRef(false);
  /**
   * Focus is on the banner or its Retry. When they go (however the cluster came back), focus would fall to
   * <body>: it goes to the heading instead. Leaving is told from removal on blur (see onBlur below).
   */
  const focusInBanner = useRef(false);
  /** When the last good answer came, and when the last answer of any kind came (for "data from N min ago"). */
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(0);
  const [round, setRound] = useState(0);
  const gate = gateFor(transport, c.id);
  const http = useMemo<FlinkHttp>(() => {
    const t = transport(c);
    return (req) => gate.run(() => t(req));
  }, [transport, c, gate]);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  useEffect(() => {
    const p = poll(() => readRef.current(http, c.name, c.timeoutMs), {
      everyMs,
      visible: () => !document.hidden,
      onResult: (r) => {
        if (r.ok) {
          // ERRORS_AND_ALERTS §4: recovering from the lost-contact banner says so once.
          if (lost.current && !opts.quiet)
            toast({ severity: 'success', message: `Back in contact with ${c.name}.` });
          lost.current = false;
          hasValue.current = true;
          fails.current = 0;
          setValue(r.value);
          setAt(Date.now());
          setError(null);
        } else {
          fails.current++;
          const e =
            r.error instanceof AppError
              ? r.error
              : new AppError('CONN-IO', { host: shortAddress(c.url), reason: 'the request failed' }, r.error);
          if (hasValue.current && fails.current >= POLL.jobs.bannerAfter && e.code.startsWith('CONN-'))
            lost.current = true;
          setError(e);
        }
        setNow(Date.now());
        setFailures(fails.current);
        setPollFails(r.ok ? 0 : r.failures);
      },
    });
    return () => p.stop();
    // restartOn: a change starts a fresh poller, which asks at once (e.g. a job that just turned FAILED).
  }, [http, round, c.name, c.timeoutMs, c.url, toast, everyMs, opts.quiet, opts.restartOn]);

  const retry = () => setRound((n) => n + 1);
  const s = Math.round(nextDelay(everyMs, pollFails) / 1000);
  const mins = Math.floor((now - at) / 60_000);
  const since = mins < 1 ? 'less than a minute ago' : `${mins} min ago`;
  const has = value !== null;
  const shown = !error
    ? null
    : !has
      ? error
      : failures < POLL.jobs.bannerAfter
        ? null
        : error.code === 'CONN-TIMEOUT'
          ? new AppError('API-TIMEOUT', { conn: c.name, s, n: Math.min(pollFails, 5) }, error)
          : error.code.startsWith('CONN-')
            ? new AppError('CONN-LOST', { conn: c.name, s, ago: since }, error)
            : error;
  const bannerUp = !!shown;
  useEffect(() => {
    if (bannerUp || !focusInBanner.current) return;
    focusInBanner.current = false;
    if (document.activeElement === document.body || !document.activeElement) heading.current?.focus();
  }, [bannerUp, heading]);
  const banner = shown && (
    <div
      className="flex flex-col gap-3"
      onFocus={() => (focusInBanner.current = true)}
      onBlur={(e) => {
        // Decided now, not later (a later check races the recovery). React delivers no blur for its own
        // removal of the banner, so a blur here is the user leaving, unless the window lost focus
        // (activeElement stays on the button). A move between its buttons: onFocus sets it again.
        if (!e.currentTarget.contains(document.activeElement)) focusInBanner.current = false;
      }}
    >
      <ErrorBanner error={shown} handles={new Set(has ? ['Retry', 'Retry now'] : [])} onAction={retry} />
      {!has && (
        <div>
          <Button icon={<RotateCw size={16} aria-hidden="true" />} onClick={retry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
  return {
    value,
    error,
    failures,
    retry,
    stale: has && !!error && failures >= POLL.jobs.staleAfter,
    since,
    banner,
  };
}
