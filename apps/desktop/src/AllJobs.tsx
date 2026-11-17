import { AppError, ErrorBanner } from '@sl/errors';
import { listJobs, type Connection, type FlinkHttp, type FlinkJobRow } from '@sl/flink';
import { Button, EmptyState, StatusBadge, Table, type Column } from '@sl/ui';
import { Inbox, LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScreenHeading } from './focus';
import { TONE, word } from './Jobs';
import { gateFor } from './usePolled';

type Row = FlinkJobRow & { conn: Connection };

/**
 * JOB-11 / board X18: the jobs of every connection in one list (Job · Connection · Status). Each connection is
 * read on its own, through its shared limiter: one that does not answer is named in FLEET-PARTIAL, and Retry
 * reads only those again (an answer still on its way is never dropped). Until every connection has answered,
 * the screen says how many it is still reading.
 * ponytail: read on open and on Retry, not polled yet; saved views (X18's chips, Save view) and Restarts (1 h)
 * (per-job history reads) are next slices.
 */
export function AllJobs({
  connections,
  transport,
  onOpenJob,
  onFleet,
}: {
  connections: Connection[];
  transport: (c: Connection) => FlinkHttp;
  onOpenJob: (connId: string, jid: string) => void;
  onFleet?: () => void;
}) {
  const h1 = useScreenHeading();
  const [read, setRead] = useState<Record<string, { rows?: FlinkJobRow[]; error?: AppError }>>({});
  // Per connection: which read is the current one (a Retry of one never drops another's answer).
  const reqs = useRef(new Map<string, number>());
  const live = useRef(true);
  const readOne = useCallback(
    (c: Connection) => {
      const id = (reqs.current.get(c.id) ?? 0) + 1;
      reqs.current.set(c.id, id);
      const mine = () => live.current && reqs.current.get(c.id) === id;
      gateFor(transport, c.id)
        .run(() => listJobs(transport(c), c.name, c.timeoutMs))
        .then(
          (rows) => mine() && setRead((r) => ({ ...r, [c.id]: { rows } })),
          (e: unknown) =>
            mine() &&
            setRead((r) => ({
              ...r,
              [c.id]: { error: e instanceof AppError ? e : new AppError('API-SHAPE', {}, e) },
            })),
        );
    },
    [transport],
  );
  useEffect(() => {
    live.current = true;
    for (const c of connections) readOne(c);
    return () => {
      live.current = false;
    };
  }, [connections, readOne]);

  const rows: Row[] = connections.flatMap((c) => (read[c.id]?.rows ?? []).map((j) => ({ ...j, conn: c })));
  const down = connections.filter((c) => read[c.id]?.error);
  const reading = connections.filter((c) => !read[c.id]).length;
  const retry = () => {
    h1.current?.focus(); // the banner and its Retry go: focus stays on the page
    setRead((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => !v.error)));
    for (const c of down) readOne(c);
  };
  const columns: Column<Row>[] = [
    {
      key: 'job',
      header: 'Job',
      render: (r) => (
        <button
          type="button"
          onClick={() => onOpenJob(r.conn.id, r.jid)}
          className="sl-focus cursor-pointer font-medium text-ink underline-offset-2 hover:underline"
        >
          {r.name}
        </button>
      ),
    },
    { key: 'conn', header: 'Connection', render: (r) => r.conn.name },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge tone={TONE[r.state] ?? 'neutral'}>{word(r.state)}</StatusBadge>,
    },
  ];
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            Jobs
          </h1>
          <p className="m-0 text-[14px] text-muted">
            All connections · {rows.length} {rows.length === 1 ? 'job' : 'jobs'}
          </p>
        </div>
        {onFleet && (
          <Button icon={<LayoutGrid size={16} aria-hidden="true" />} onClick={onFleet}>
            Fleet
          </Button>
        )}
      </div>
      {down.length > 0 && (
        <ErrorBanner
          error={new AppError('FLEET-PARTIAL', { n: down.length, names: down.map((c) => c.name).join(', ') })}
          handles={new Set(['Retry'])}
          onAction={retry}
        />
      )}
      <p role="status" className={reading ? 'm-0 text-[13px] text-muted' : 'sr-only'}>
        {reading ? `Reading the jobs of ${reading} connection${reading === 1 ? '' : 's'}…` : ''}
      </p>
      {!reading && !rows.length && !down.length ? (
        <EmptyState icon={Inbox} title="No jobs on any connection yet" />
      ) : (
        <Table
          label="Jobs on all connections"
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.conn.id}/${r.jid}`}
        />
      )}
    </main>
  );
}
