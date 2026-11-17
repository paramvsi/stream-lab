import { AppError, ErrorBanner } from '@sl/errors';
import { listJobs, type Connection, type FlinkHttp, type FlinkJobRow } from '@sl/flink';
import { StatusBadge, Table, type Column } from '@sl/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScreenHeading } from './focus';
import { TONE, word } from './Jobs';
import { gateFor } from './usePolled';

type Row = FlinkJobRow & { conn: Connection };

/**
 * JOB-11 / board X18: the jobs of every connection in one list (Job · Connection · Status). Each connection is
 * read through its shared limiter; one that does not answer is named in FLEET-PARTIAL (Retry reads them again)
 * and the rest still show.
 * ponytail: read on open and on Retry, not polled yet; saved views (X18's chips, Save view) and Restarts (1 h)
 * (per-job history reads) are next slices.
 */
export function AllJobs({
  connections,
  transport,
  onOpenJob,
}: {
  connections: Connection[];
  transport: (c: Connection) => FlinkHttp;
  onOpenJob: (connId: string, jid: string) => void;
}) {
  const h1 = useScreenHeading();
  const [read, setRead] = useState<Record<string, { rows?: FlinkJobRow[]; error?: AppError }>>({});
  const req = useRef(0);
  const load = useCallback(() => {
    const id = ++req.current;
    for (const c of connections)
      gateFor(transport, c.id)
        .run(() => listJobs(transport(c), c.name, c.timeoutMs))
        .then(
          (rows) => id === req.current && setRead((r) => ({ ...r, [c.id]: { rows } })),
          (e: unknown) =>
            id === req.current &&
            setRead((r) => ({
              ...r,
              [c.id]: { error: e instanceof AppError ? e : new AppError('API-SHAPE', {}, e) },
            })),
        );
  }, [connections, transport]);
  useEffect(() => {
    load();
    const r = req;
    return () => {
      r.current++;
    };
  }, [load]);

  const rows: Row[] = connections.flatMap((c) => (read[c.id]?.rows ?? []).map((j) => ({ ...j, conn: c })));
  const down = connections.filter((c) => read[c.id]?.error);
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
      <div className="flex flex-col gap-1">
        <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
          Jobs
        </h1>
        <p className="m-0 text-[14px] text-muted">
          All connections · {rows.length} {rows.length === 1 ? 'job' : 'jobs'}
        </p>
      </div>
      {down.length > 0 && (
        <ErrorBanner
          error={new AppError('FLEET-PARTIAL', { n: down.length, names: down.map((c) => c.name).join(', ') })}
          handles={new Set(['Retry'])}
          onAction={() => {
            setRead((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => !v.error)));
            load();
          }}
        />
      )}
      <Table
        label="Jobs on all connections"
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.conn.id}/${r.jid}`}
      />
    </main>
  );
}
