import {
  bucketCounts,
  jobBucket,
  listJobs,
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
import { Inbox, LayoutGrid, Server } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useScreenHeading } from './focus';
import { usePolled } from './usePolled';

export const TONE: Record<string, BadgeTone> = {
  RUNNING: 'success',
  // Board D07: the restarting pill is danger-50 / danger-600.
  RESTARTING: 'error',
  FAILING: 'error',
  FAILED: 'error',
};
/** Words with every colour (DoD): "RESTARTING" → "Restarting". */
export const word = (state: string) => state.charAt(0) + state.slice(1).toLowerCase();
/** Board D07 "Uptime": 12 min, 3 h, 6 d. */
export const uptime = (ms: number) =>
  ms < 3_600_000
    ? `${Math.max(1, Math.floor(ms / 60_000))} min`
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
  onCluster,
  onOpenJob,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  onFleet?: () => void;
  onCluster?: () => void;
  /** A row opens that job (JOB-02, D08). */
  onOpenJob?: (jid: string) => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Jobs · Stream Lab';
  }, []);
  const { value: rows, stale, since, banner } = usePolled(c, transport, listJobs, h1);
  const search = useRef<HTMLInputElement>(null);
  const [bucket, setBucket] = useState<JobBucket | undefined>();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ by: JobSort; desc: boolean } | null>(null);
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
    {
      key: 'name',
      header: header('name', 'Job'),
      ...order('name'),
      // A real button: it says it opens something (a row with a click handler does not), and Tab reaches it.
      render: (r) =>
        onOpenJob ? (
          <button
            type="button"
            className="sl-focus -mx-1 rounded-sm px-1 text-left font-medium text-rose-700 hover:underline"
            onClick={() => onOpenJob(r.jid)}
          >
            {r.name}
          </button>
        ) : (
          r.name
        ),
    },
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
  const filtered = !!(bucket || q.trim());
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {banner}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            Jobs
          </h1>
          <p className="m-0 text-[14px] text-muted">
            {rows ? `${rows.length} job${rows.length === 1 ? '' : 's'} on ${c.name}` : c.name}
          </p>
        </div>
        <div className="flex gap-3">
          {onFleet && (
            <Button icon={<LayoutGrid size={16} aria-hidden="true" />} onClick={onFleet}>
              Fleet
            </Button>
          )}
          {onCluster && (
            <Button icon={<Server size={16} aria-hidden="true" />} onClick={onCluster}>
              Cluster
            </Button>
          )}
        </div>
      </div>
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
              {rows ? `${ch.label} ${counts[ch.key]}` : ch.label}
            </Button>
          ))}
        </div>
      </div>
      {!rows ? (
        !banner && (
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
        <>
          {stale && <p className="m-0 text-[13px] text-muted">Not answering. Showing data from {since}.</p>}
          <Table label="Jobs" columns={columns} rows={shown} rowKey={(r) => r.jid} />
        </>
      )}
      {/* Mounted empty, so the words are announced when they come (a region born full often is not). Outside the rows
      branch: search and chips work while loading too. */}
      <div data-testid="jobs-match" role="status" className="flex items-center gap-3 text-[14px] text-muted">
        {!!rows?.length && shown.length === 0 && filtered && (
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
