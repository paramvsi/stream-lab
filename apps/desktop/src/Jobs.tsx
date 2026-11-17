import { AppError, ErrorBanner } from '@sl/errors';
import {
  bucketCounts,
  jobBucket,
  limiter,
  listJobs,
  nextDelay,
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
  useToast,
} from '@sl/ui';
import { Inbox, LayoutGrid, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shortAddress } from './Connections';
import { useScreenHeading } from './focus';

const TONE: Record<string, BadgeTone> = {
  RUNNING: 'success',
  // Board D07: the restarting pill is danger-50 / danger-600.
  RESTARTING: 'error',
  FAILING: 'error',
  FAILED: 'error',
};
/** Words with every colour (DoD): "RESTARTING" → "Restarting". */
const word = (state: string) => state.charAt(0) + state.slice(1).toLowerCase();
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
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  onFleet?: () => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Jobs · Stream Lab';
  }, []);
  const toast = useToast();
  const [rows, setRows] = useState<FlinkJobRow[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  /** Failures in a row, across Retries (a Retry starts a new poller, but the cluster may still be down). */
  const [failures, setFailures] = useState(0);
  const fails = useRef(0);
  /** The poller's own count (a Retry restarts it, and with it the back-off): the wait the banner names. */
  const [pollFails, setPollFails] = useState(0);
  /** Rows were on screen when the 3rd failure came: CONN-LOST / API-TIMEOUT was shown (its recovery toasts). */
  const lost = useRef(false);
  const hasRows = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  /**
   * Focus is on the banner or its Retry. When they go (however the cluster came back), focus would fall to
   * <body>: it goes to the heading instead. Removal fires no blur with a target, so leaving to elsewhere clears it.
   */
  const focusInBanner = useRef(false);
  const bannerBox = useRef<HTMLDivElement>(null);
  // A press anywhere outside the banner leaves it too, even on text that takes no focus (blur then has no
  // relatedTarget, the same as the banner's removal).
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!bannerBox.current?.contains(e.target as Node)) focusInBanner.current = false;
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  /** When the last good answer came, and when the last answer of any kind came (for "data from N min ago"). */
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(0);
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
    const p = poll(() => listJobs(http, c.name, c.timeoutMs), {
      everyMs: POLL.jobs.everyMs,
      visible: () => !document.hidden,
      onResult: (r) => {
        if (r.ok) {
          // ERRORS_AND_ALERTS §4: recovering from the lost-contact banner says so once.
          if (lost.current) toast({ severity: 'success', message: `Back in contact with ${c.name}.` });
          lost.current = false;
          hasRows.current = true;
          fails.current = 0;
          setRows(r.value);
          setAt(Date.now());
          setError(null);
        } else {
          fails.current++;
          const e =
            r.error instanceof AppError
              ? r.error
              : new AppError('CONN-IO', { host: shortAddress(c.url), reason: 'the request failed' }, r.error);
          if (hasRows.current && fails.current >= POLL.jobs.bannerAfter && e.code.startsWith('CONN-'))
            lost.current = true;
          setError(e);
        }
        setNow(Date.now());
        setFailures(fails.current);
        setPollFails(r.ok ? 0 : r.failures);
      },
    });
    return () => p.stop();
  }, [http, round, c.name, c.timeoutMs, c.url, toast]);

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
  const retry = () => setRound((n) => n + 1);
  // With rows on screen, a lost cluster is CONN-LOST (or API-TIMEOUT) over the kept rows (§4); an API answer
  // (401, 404, shape…) keeps its own code. Before any rows, the error itself, with a Retry of our own.
  const s = Math.round(nextDelay(POLL.jobs.everyMs, pollFails) / 1000);
  const mins = Math.floor((now - at) / 60_000);
  const since = mins < 1 ? 'less than a minute ago' : `${mins} min ago`;
  const banner = !error
    ? null
    : !rows
      ? error
      : failures < POLL.jobs.bannerAfter
        ? null
        : error.code === 'CONN-TIMEOUT'
          ? new AppError('API-TIMEOUT', { conn: c.name, s, n: Math.min(pollFails, 5) }, error)
          : error.code.startsWith('CONN-')
            ? new AppError('CONN-LOST', { conn: c.name, s, ago: since }, error)
            : error;
  const stale = !!rows && !!error && failures >= POLL.jobs.staleAfter;
  const filtered = !!(bucket || q.trim());
  // A banner whose button had focus went away (Retry now worked): focus goes to the heading, not <body>.
  const bannerUp = !!banner;
  useEffect(() => {
    if (bannerUp || !focusInBanner.current) return;
    focusInBanner.current = false;
    if (document.activeElement === document.body || !document.activeElement) h1.current?.focus();
  }, [bannerUp, h1]);
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {banner && (
        <div
          ref={bannerBox}
          className="flex flex-col gap-3"
          onFocus={() => (focusInBanner.current = true)}
          onBlur={(e) => {
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node))
              focusInBanner.current = false;
          }}
        >
          <ErrorBanner
            error={banner}
            handles={new Set(rows ? ['Retry', 'Retry now'] : [])}
            onAction={retry}
          />
          {!rows && (
            <div>
              <Button icon={<RotateCw size={16} aria-hidden="true" />} onClick={retry}>
                Retry
              </Button>
            </div>
          )}
        </div>
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
