import { AppError, ErrorBanner } from '@sl/errors';
import {
  bucketCounts,
  listJobs,
  queryJobs,
  type Connection,
  type FlinkHttp,
  type FlinkJobRow,
  type JobBucket,
} from '@sl/flink';
import { Button, EmptyState, Field, Input, StatusBadge, Table, type Column } from '@sl/ui';
import { Inbox, LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScreenHeading } from './focus';
import { CHIPS, TONE, word } from './Jobs';
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

  const all: Row[] = connections.flatMap((c) => (read[c.id]?.rows ?? []).map((j) => ({ ...j, conn: c })));
  // The Jobs list's own chips and search (D07b), across connections.
  const [bucket, setBucket] = useState<JobBucket | undefined>();
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const counts = bucketCounts(all);
  const rows = queryJobs(all, { ...(bucket ? { bucket } : {}), q });
  const down = connections.filter((c) => read[c.id]?.error);
  const reading = connections.filter((c) => !read[c.id]).length;
  // The list is whole only when every connection has answered with its jobs: counts and "no match" wait for it (a
  // connection still reading, or down, may hold the very jobs they would say are not there).
  const whole = !reading && !connections.some((c) => read[c.id]?.error);
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
            All connections · {all.length} {all.length === 1 ? 'job' : 'jobs'}
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
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search jobs" className="w-[280px]">
          <Input
            ref={search}
            type="search"
            placeholder="Name or ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <div className="inline-flex gap-0.5 rounded-[9px] border border-line bg-subtle p-0.5">
          {CHIPS.map((ch) => (
            <Button
              key={ch.key}
              size="sm"
              variant={bucket === ch.bucket ? 'secondary' : 'ghost'}
              aria-pressed={bucket === ch.bucket}
              onClick={() => setBucket(ch.bucket)}
            >
              {/* A count only when the list is whole: never "Failing 0" for jobs not read. */}
              {whole ? `${ch.label} ${counts[ch.key]}` : ch.label}
            </Button>
          ))}
        </div>
      </div>
      <p role="status" className={reading ? 'm-0 text-[13px] text-muted' : 'sr-only'}>
        {reading ? `Reading the jobs of ${reading} connection${reading === 1 ? '' : 's'}…` : ''}
      </p>
      {!reading && !all.length && !down.length ? (
        <EmptyState icon={Inbox} title="No jobs on any connection yet" />
      ) : (
        <Table
          label="Jobs on all connections"
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.conn.id}/${r.jid}`}
        />
      )}
      {/* As the Jobs list (D07b): mounted empty so the words are announced, and one step to clear. */}
      <div role="status" className="flex items-center gap-3 text-[14px] text-muted">
        {whole && !!all.length && rows.length === 0 && (!!bucket || !!q.trim()) && (
          <>
            No jobs match this search or filter.
            <Button
              size="sm"
              onClick={() => {
                setQ('');
                setBucket(undefined);
                search.current?.focus();
              }}
            >
              Clear search and filter
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
