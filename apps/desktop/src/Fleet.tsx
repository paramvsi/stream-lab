import { AppError, ErrorBanner, present } from '@sl/errors';
import { fleetStatus, poll, POLL, type Connection, type FlinkHttp, type FleetStatus } from '@sl/flink';
import { Button, Skeleton, StatusBadge } from '@sl/ui';
import { List, Plus, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DOT, ENV, shortAddress } from './Connections';
import { useScreenHeading } from './focus';

type Card = { status?: FleetStatus; at?: number };

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

/**
 * FLEET-01 / boards D04 (healthy), D04b (one unreachable), D04c (loading), D04d (offline, cached data): a card per
 * connection, polled every 15 s (POLL.fleet, backing off on failures). An unreachable cluster keeps its card with
 * the catalog message and Retry; offline, the cards keep their last data under CONN-OFFLINE.
 * ponytail: no "Needs attention" table yet (it needs each job's restarts and backpressure: M7), and Open waits
 * for the cluster pages (M7).
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
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [retry, setRetry] = useState(0);
  const ids = connections.map((c) => c.id).join();
  useEffect(() => {
    if (!online) return; // offline: keep the last data, ask nothing (D04d)
    const pollers = connections.map((c) =>
      poll(
        async () => {
          const s = await fleetStatus(transport(c), c.name);
          if (s.state === 'down') throw s;
          return s;
        },
        {
          everyMs: POLL.fleet.everyMs,
          onResult: (r) =>
            setCards((x) => ({
              ...x,
              [c.id]: r.ok
                ? { status: r.value, at: Date.now() }
                : { status: r.error as FleetStatus, ...(x[c.id]?.at ? { at: x[c.id]!.at } : {}) },
            })),
        },
      ),
    );
    return () => pollers.forEach((p) => p.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart when the connections, the network or a Retry change
  }, [ids, online, transport, retry]);
  const up = Object.values(cards).flatMap((c) => (c.status?.state === 'up' ? [c.status] : []));
  const jobs = up.reduce((n, s) => n + s.running + s.failing, 0);
  const oldest = Math.min(...Object.values(cards).flatMap((c) => (c.at ? [c.at] : [])));
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-8">
      {!online && (
        <ErrorBanner
          error={
            new AppError('CONN-OFFLINE', {
              ago: Number.isFinite(oldest) ? ago(now - oldest) : 'never',
            })
          }
        />
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
        {connections.map((c) => {
          const s = cards[c.id]?.status;
          return (
            <li
              key={c.id}
              aria-labelledby={`fleet-${c.id}`}
              className="flex flex-col gap-3 rounded-xl border border-line p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id={`fleet-${c.id}`} className="m-0 flex items-center gap-2 text-[16px] font-semibold">
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${DOT[c.color ?? c.env]}`}
                  />
                  {c.name}
                </h2>
                {!s ? (
                  <StatusBadge tone="neutral">Loading</StatusBadge>
                ) : s.state === 'up' ? (
                  <StatusBadge tone="success">Healthy</StatusBadge>
                ) : (
                  <StatusBadge tone="error">Unreachable</StatusBadge>
                )}
              </div>
              <p className="m-0 font-mono text-[13px] text-muted">{shortAddress(c.url)}</p>
              {!s ? (
                <div aria-hidden="true" className="flex flex-col gap-2">
                  <Skeleton height={20} />
                  <Skeleton height={20} width="66%" />
                </div>
              ) : s.state === 'up' ? (
                <dl className="m-0 grid grid-cols-3 gap-2">
                  {[
                    ['Running', String(s.running)],
                    ['Failing', String(s.failing)],
                    ['Slots free', `${s.slotsFree} / ${s.slotsTotal}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <dt className="text-[12px] text-muted">{k}</dt>
                      <dd className="m-0 text-[18px] font-semibold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="m-0 text-[14px]">
                    {present(s.error).message}
                    {cards[c.id]?.at ? ` Last seen ${ago(now - cards[c.id]!.at!)}.` : ''}
                  </p>
                  <Button
                    size="sm"
                    icon={<RotateCw size={14} aria-hidden="true" />}
                    aria-label={`Retry ${c.name}`}
                    onClick={() => setRetry((n) => n + 1)}
                  >
                    Retry
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
                <span>
                  {ENV[c.env]}
                  {s?.state === 'up' ? ` · Flink ${s.version}` : ''}
                </span>
                <Button size="sm" disabledReason="Cluster pages come with the next milestone (M7).">
                  Open
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
