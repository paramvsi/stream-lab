import { AppError, ErrorBanner, present } from '@sl/errors';
import {
  fleetStatus,
  limiter,
  poll,
  POLL,
  type Connection,
  type FlinkHttp,
  type FleetStatus,
} from '@sl/flink';
import { Button, Skeleton, StatusBadge, useToast, type BadgeTone } from '@sl/ui';
import { List, Plus, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DOT, ENV, shortAddress } from './Connections';
import { useScreenHeading } from './focus';

type Up = Extract<FleetStatus, { state: 'up' }>;
/** What a card knows: its last good answer (kept through failures) and the failures in a row since. */
interface CardState {
  last?: Up;
  at?: number;
  error?: AppError;
  failures: number;
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'just now' : `${m} min ago`;
};

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** The error is shown (in place of the numbers) when there is nothing else to show, or after 3 failures in a row. */
const showsError = (s: CardState) => !!s.error && (!s.last || s.failures >= 3);

/** The card's status in words (never colour alone): a cluster that answered with an error is not "unreachable". */
function badge(s: CardState, online: boolean): [BadgeTone, string] {
  if (showsError(s)) {
    if (s.error!.code === 'API-401') return ['error', 'Signed out'];
    return s.error!.code.startsWith('CONN-') ? ['error', 'Unreachable'] : ['error', 'Error'];
  }
  if (!s.last) return online ? ['neutral', 'Loading'] : ['neutral', 'Offline'];
  // ERRORS_AND_ALERTS: 1 failure is a silent retry, 2 mark the data stale (FLINK_API: fleet "stale after 2").
  if (s.failures >= POLL.fleet.staleAfter) return ['warning', 'Stale'];
  return ['success', 'Healthy'];
}

function FleetCard({
  c,
  transport,
  online,
  now,
  onState,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  online: boolean;
  now: number;
  onState: (id: string, s: CardState) => void;
}) {
  const toast = useToast();
  const [s, setS] = useState<CardState>({ failures: 0 });
  const cur = useRef(s);
  const [round, setRound] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const retryFocused = useRef(false);
  // At most 6 requests in flight per connection (FLINK_API "Concurrency"), across Retries too.
  const gate = useMemo(() => limiter(), []);
  const http = useMemo<FlinkHttp>(() => {
    let t: FlinkHttp;
    try {
      t = transport(c);
    } catch (e) {
      // No way to reach this one (a kind the transport can not do yet): its card says so, the rest still work.
      t = () =>
        Promise.reject(new AppError('CONN-IO', { host: shortAddress(c.url), reason: 'no transport' }, e));
    }
    return (req) => gate.run(() => t(req));
  }, [transport, c, gate]);
  useEffect(() => {
    if (!online) return; // offline: keep the last data and ask nothing (D04d)
    const p = poll(
      async () => {
        const r = await fleetStatus(http, c.name, c.timeoutMs);
        if (r.state === 'down') throw r.error;
        return r;
      },
      {
        everyMs: POLL.fleet.everyMs,
        visible: () => !document.hidden,
        onResult: (r) => {
          const x = cur.current;
          let next: CardState;
          if (r.ok) {
            // ERRORS_AND_ALERTS: recovering says so once.
            if (x.last && showsError(x))
              toast({ severity: 'success', message: `Back in contact with ${c.name}.` });
            next = { last: r.value, at: Date.now(), failures: 0 };
          } else {
            const error =
              r.error instanceof AppError
                ? r.error
                : new AppError(
                    'CONN-IO',
                    { host: shortAddress(c.url), reason: 'the request failed' },
                    r.error,
                  );
            next = { ...x, error, failures: r.failures };
          }
          cur.current = next;
          setRetrying(false);
          setS(next);
        },
      },
    );
    return () => p.stop();
  }, [http, online, round, c.name, c.timeoutMs, c.url, toast]);
  useEffect(() => onState(c.id, s), [c.id, s, onState]);
  const [tone, word] = badge(s, online);
  const errorShown = showsError(s);
  useEffect(() => {
    // A Retry that worked removes its button: focus goes to the card, not the page.
    if (!errorShown && retryFocused.current) {
      retryFocused.current = false;
      heading.current?.focus();
    }
  }, [errorShown]);
  return (
    <li aria-labelledby={`fleet-${c.id}`} className="flex flex-col gap-3 rounded-xl border border-line p-5">
      <div className="flex items-center justify-between gap-3">
        <h2
          ref={heading}
          tabIndex={-1}
          id={`fleet-${c.id}`}
          className="m-0 flex items-center gap-2 text-[16px] font-semibold outline-none"
        >
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[c.color ?? c.env]}`} />
          {c.name}
        </h2>
        <StatusBadge tone={tone}>{word}</StatusBadge>
      </div>
      <p className="m-0 font-mono text-[13px] text-muted">{shortAddress(c.url)}</p>
      {errorShown ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-[14px]">
            {present(s.error!).message}
            {s.at ? ` Last seen ${ago(now - s.at)}.` : ''}
          </p>
          <Button
            size="sm"
            icon={<RotateCw size={14} aria-hidden="true" />}
            aria-label={`Retry ${c.name}`}
            {...(!online
              ? { disabledReason: 'You are offline.' }
              : retrying
                ? { disabledReason: 'Retrying now.' }
                : {})}
            onFocus={() => (retryFocused.current = true)}
            onBlur={() => (retryFocused.current = false)}
            onClick={() => {
              setRetrying(true);
              setRound((n) => n + 1);
            }}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : s.last ? (
        <dl className="m-0 grid grid-cols-3 gap-2">
          {[
            ['Running', String(s.last.running)],
            ['Failing', String(s.last.failing)],
            ['Slots free', `${s.last.slotsFree} / ${s.last.slotsTotal}`],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="m-0 text-[18px] font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : online ? (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton height={20} />
          <Skeleton height={20} width="66%" />
        </div>
      ) : (
        <p className="m-0 text-[14px] text-muted">
          No data yet. Stream Lab connects when the network is back.
        </p>
      )}
      {word === 'Stale' && s.at && (
        <p className="m-0 text-[13px] text-muted">Not answering. Showing data from {ago(now - s.at)}.</p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
        <span>
          {ENV[c.env]}
          {s.last ? ` · Flink ${s.last.version}` : ''}
        </span>
        <Button size="sm" disabledReason="Cluster pages come with the next milestone (M7).">
          Open
        </Button>
      </div>
    </li>
  );
}

/**
 * FLEET-01 / boards D04 (healthy), D04b (one unreachable), D04c (loading), D04d (offline, cached data): a card per
 * connection, each polling on its own every 15 s (POLL.fleet: back-off, paused while the window is hidden, at most
 * 6 in flight). A card keeps its last data through failures: 1 is silent, 2 mark it Stale, 3 show the catalog
 * message with Retry (and "Back in contact" once it answers again). Offline, cards keep their data under
 * CONN-OFFLINE and ask nothing.
 * ponytail: no "Needs attention" table yet (it needs each job's restarts and backpressure: M7), Open waits for the
 * cluster pages (M7), and API-401's Reconnect / Disconnect wait for the keychain (Retry for now).
 */
export function Fleet({
  connections,
  transport,
  onAdd,
  onManage,
}: {
  connections: Connection[];
  transport: (c: Connection) => FlinkHttp;
  onAdd: () => void;
  onManage: () => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Fleet · Stream Lab';
  }, []);
  const online = useOnline();
  // "Last seen 4 min ago" / "data from 2 min ago" move on by themselves.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const onState = useMemo(() => (id: string, s: CardState) => setCards((x) => ({ ...x, [id]: s })), []);
  const known = connections.flatMap((c) => (cards[c.id]?.last ? [cards[c.id]!] : []));
  const jobs = known.reduce((n, s) => n + s.last!.jobs, 0);
  const oldest = Math.min(...known.map((s) => s.at!));
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-8">
      {!online && known.length > 0 && (
        <ErrorBanner error={new AppError('CONN-OFFLINE', { ago: ago(now - oldest) })} />
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            Fleet
          </h1>
          <p className="m-0 text-[14px] text-muted">
            {connections.length} connection{connections.length === 1 ? '' : 's'} · {jobs} job
            {jobs === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button icon={<List size={16} aria-hidden="true" />} onClick={onManage}>
            Connections
          </Button>
          <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={onAdd}>
            Add connection
          </Button>
        </div>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 p-0">
        {connections.map((c) => (
          <FleetCard key={c.id} c={c} transport={transport} online={online} now={now} onState={onState} />
        ))}
      </ul>
    </main>
  );
}
