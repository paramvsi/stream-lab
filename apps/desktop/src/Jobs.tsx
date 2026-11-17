import { AppError, ErrorBanner } from '@sl/errors';
import {
  bucketCounts,
  jobBucket,
  limiter,
  listJobs,
  poll,
  POLL,
  queryJobs,
  type Connection,
  type FlinkHttp,
  type FlinkJobRow,
  type JobBucket,
  type JobSort,
} from '@sl/flink';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  Skeleton,
  StatusBadge,
  Table,
  type BadgeTone,
  type Column,
} from '@sl/ui';
import { Inbox, LayoutGrid } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { shortAddress } from './Connections';
import { useScreenHeading } from './focus';

const TONE: Record<string, BadgeTone> = {
  RUNNING: 'success',
  RESTARTING: 'warning',
  FAILING: 'warning',
  FAILED: 'error',
};
/** Words with every colour (DoD): "RESTARTING" → "Restarting". */
const word = (state: string) => state.charAt(0) + state.slice(1).toLowerCase();
/** Board D07 "Uptime": 12 min, 3 h, 6 d. */
export const uptime = (ms: number) =>
  ms < 3_600_000
    ? `${Math.max(1, Math.round(ms / 60_000))} min`
    : ms < 86_400_000
      ? `${Math.floor(ms / 3_600_000)} h`
      : `${Math.floor(ms / 86_400_000)} d`;

const CHIPS: { bucket?: JobBucket; label: string; key: 'all' | JobBucket }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', bucket: 'running', label: 'Running' },
  { key: 'failing', bucket: 'failing', label: 'Failing' },
  { key: 'finished', bucket: 'finished', label: 'Finished' },
];

/**
 * JOB-01 / boards D07 (list), D07b (filtered), D07c (empty), D07d (loading): one connection's jobs from
 * /jobs/overview, polled every 5 s (POLL.jobs: back-off, paused while hidden, a banner after 3 failures in a row;
 * the rows stay). Chips by state, Name-or-ID search, sort by a column header.
 * ponytail: Warning, Parallelism, Records in and Trend need each job's detail and metrics (JOB-02's calls), and
 * D07c's Submit JAR / Open SQL editor need those screens; Saved views is v1 (JOB-09).
 */
export function Jobs({
  c,
  transport,
  onFleet,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  onFleet?: () => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Jobs · Stream Lab';
  }, []);
  const [rows, setRows] = useState<FlinkJobRow[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [failures, setFailures] = useState(0);
  const [round, setRound] = useState(0);
  const [bucket, setBucket] = useState<JobBucket | undefined>();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ by: JobSort; desc: boolean } | null>(null);
  const gate = useMemo(() => limiter(), []);
  const http = useMemo<FlinkHttp>(() => {
    const t = transport(c);
    return (req) => gate.run(() => t(req));
  }, [transport, c, gate]);
  useEffect(() => {
    let n = 0;
    const p = poll(() => listJobs(http, c.name, c.timeoutMs), {
      everyMs: POLL.jobs.everyMs,
      visible: () => !document.hidden,
      onResult: (r) => {
        if (r.ok) {
          n = 0;
          setRows(r.value);
          setError(null);
        } else {
          n = r.failures;
          setError(
            r.error instanceof AppError
              ? r.error
              : new AppError('CONN-IO', { host: shortAddress(c.url), reason: 'the request failed' }, r.error),
          );
        }
        setFailures(n);
      },
    });
    return () => p.stop();
  }, [http, round, c.name, c.timeoutMs, c.url]);

  const counts = bucketCounts(rows ?? []);
  const shown = rows
    ? queryJobs(rows, {
        ...(bucket ? { bucket } : {}),
        q,
        ...(sort ? { sort: sort.by, desc: sort.desc } : {}),
      })
    : [];
  const header = (by: JobSort, label: string) => (
    <button
      type="button"
      className="sl-focus -mx-1 rounded-sm px-1 text-inherit"
      onClick={() => setSort((s) => (s?.by === by ? { by, desc: !s.desc } : { by, desc: false }))}
    >
      {label}
      {sort?.by === by && <span aria-hidden="true">{sort.desc ? ' ↓' : ' ↑'}</span>}
    </button>
  );
  const order = (by: JobSort) =>
    sort?.by === by ? { sort: sort.desc ? ('descending' as const) : ('ascending' as const) } : {};
  const columns: Column<FlinkJobRow>[] = [
    { key: 'name', header: header('name', 'Job'), ...order('name'), render: (r) => r.name },
    {
      key: 'state',
      header: header('state', 'Status'),
      ...order('state'),
      render: (r) => <StatusBadge tone={TONE[r.state] ?? 'neutral'}>{word(r.state)}</StatusBadge>,
    },
    {
      key: 'uptime',
      header: header('duration', 'Uptime'),
      ...order('duration'),
      mono: true,
      render: (r) => (jobBucket(r.state) === 'finished' ? '—' : uptime(r.duration)),
    },
  ];
  const bannerShown = error && (!rows || failures >= POLL.jobs.bannerAfter);
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {bannerShown && (
        <ErrorBanner error={error} handles={new Set(['Retry'])} onAction={() => setRound((n) => n + 1)} />
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            Jobs
          </h1>
          <p className="m-0 text-[14px] text-muted">
            {rows ? `${rows.length} job${rows.length === 1 ? '' : 's'} on ${c.name}` : c.name}
          </p>
        </div>
        {onFleet && (
          <Button icon={<LayoutGrid size={16} aria-hidden="true" />} onClick={onFleet}>
            Fleet
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search jobs" className="w-[280px]">
          <Input type="search" placeholder="Name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
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
              {`${ch.label} ${counts[ch.key]}`}
            </Button>
          ))}
        </div>
      </div>
      {!rows ? (
        !error && (
          <Loading label="Loading jobs">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={46} />
            ))}
          </Loading>
        )
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No jobs on this cluster yet">
          Submit a JAR, run SQL, or send a pipeline from the simulator.
        </EmptyState>
      ) : (
        <Table label="Jobs" columns={columns} rows={shown} rowKey={(r) => r.jid} />
      )}
    </main>
  );
}
