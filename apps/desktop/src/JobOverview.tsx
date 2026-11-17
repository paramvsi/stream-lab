import { AppError, ErrorBanner, ErrorPage, present } from '@sl/errors';
import {
  checkpointingOff,
  getCheckpoints,
  getJob,
  lastCompleted,
  POLL,
  type Connection,
  type FlinkCheckpoint,
  type FlinkHttp,
  type FlinkVertex,
} from '@sl/flink';
import { Button, Loading, Skeleton, StatusBadge, Table, type Column } from '@sl/ui';
import { ListChecks, SearchX } from 'lucide-react';
import { useEffect } from 'react';
import { useScreenHeading } from './focus';
import { Kpi } from './Kpi';
import { TONE, word } from './Jobs';
import { usePolled } from './usePolled';

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
/** Board D08 "started 6 days ago": whole minutes, hours or days, in words. */
export const ago = (ms: number) =>
  ms < 3_600_000
    ? `${plural(Math.max(1, Math.floor(ms / 60_000)), 'minute')} ago`
    : ms < 86_400_000
      ? `${plural(Math.floor(ms / 3_600_000), 'hour')} ago`
      : `${plural(Math.floor(ms / 86_400_000), 'day')} ago`;

/** "820 ms", "3.4 s", "2 min 5 s": rounded first, so 59.95 s is "1 min 0 s", never "60.0 s" or "1 min 60 s". */
export const duration = (ms: number) => {
  if (ms < 999.5) return `${Math.round(ms)} ms`;
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)} s`;
  const s = Math.round(ms / 1_000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};
/** "500 B", "220 MB", "1.4 GB" (binary units, as Flink's own UI); a size Flink did not send is "—", not 0. */
export const size = (b: number | undefined) => {
  if (b === undefined) return '—';
  if (b < 1024) return `${Math.round(b)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  // Shown as whole KB / MB, one decimal from GB: carry when the shown value would read 1024.
  const shown = (v: number, i: number) => (i >= 2 ? Math.round(v * 10) / 10 : Math.round(v));
  let v = b / 1024;
  let i = 0;
  while (i < units.length - 1 && shown(v, i) >= 1024) {
    v /= 1024;
    i++;
  }
  return i >= 2 ? `${v.toFixed(1)} ${units[i]}` : `${Math.round(v)} ${units[i]}`;
};
/** Board D08 KPI note "2 min ago": the short form. */
const shortAgo = (ms: number) =>
  ms < 3_600_000
    ? `${Math.max(1, Math.floor(ms / 60_000))} min ago`
    : ms < 86_400_000
      ? `${Math.floor(ms / 3_600_000)} h ago`
      : `${Math.floor(ms / 86_400_000)} d ago`;

type Failures = { n: number; more: boolean };
type Ckpt = { off: true } | { off: false; last: FlinkCheckpoint | null; failed: Failures };
/**
 * Board D08c "3 failures in a row": FAILED checkpoints since the last completed one, newest first. Savepoints
 * are left out (a failed stop-with-savepoint is not a checkpoint failure; latest.completed holds checkpoints
 * only), as is one in progress. Flink keeps only the last web.checkpoints.history entries (10 by default): a run
 * that reaches the oldest entry kept, when counts.total says more were started than are kept, is "N+" = at least N.
 * It is never too low; it can read "+" when nothing was dropped, because a trigger that fails before it starts
 * (tasks still deploying, a restarting region) counts in total with no history entry. A short history is exact.
 */
const failedInRow = (h: readonly FlinkCheckpoint[], total: number): Failures => {
  let n = 0;
  for (const c of [...h].filter((c) => !c.is_savepoint).sort((a, b) => b.id - a.id)) {
    if (c.status === 'IN_PROGRESS') continue;
    if (c.status !== 'FAILED') return { n, more: false };
    n++;
  }
  // The whole kept history is this run: older entries may be failures too, if any were dropped.
  return { n, more: n > 0 && total > h.length };
};
const failedNote = (f: Failures) =>
  `${f.n}${f.more ? '+' : ''} failure${f.n === 1 && !f.more ? '' : 's'} in a row`;

/**
 * Checkpoints for the D08 KPI. Off is either Flink's 404 (no settings: JOB-CKPT-NONE) or zero counts with the
 * disabled interval (checkpointingOff reads the config only then, so a running job pays one call, not two).
 */
async function readCkpt(http: FlinkHttp, conn: string, jid: string, t: number): Promise<Ckpt> {
  try {
    const s = await getCheckpoints(http, conn, jid, t);
    if (s.counts.total === 0 && (await checkpointingOff(http, conn, jid, t))) return { off: true };
    return { off: false, last: lastCompleted(s), failed: failedInRow(s.history, s.counts.total) };
  } catch (e) {
    if (e instanceof AppError && e.code === 'JOB-CKPT-NONE') return { off: true };
    throw e;
  }
}

const columns: Column<FlinkVertex>[] = [
  { key: 'name', header: 'Operator', render: (v) => v.name },
  { key: 'p', header: 'Parallelism', mono: true, align: 'right', render: (v) => v.parallelism },
  {
    key: 'status',
    header: 'Status',
    render: (v) => <StatusBadge tone={TONE[v.status] ?? 'neutral'}>{word(v.status)}</StatusBadge>,
  },
];

/**
 * JOB-02 / board D08: one job from /jobs/:jid, polled every 2 s while visible (FLINK_API "Open job overview"),
 * with usePolled's §4 errors. A job the cluster no longer has is API-404-JOB's full-page state (Back to list).
 * ponytail: the job graph (xyflow, D08), the KPIs records in, watermark lag and restarts (metrics, history), the
 * History / Exceptions / Checkpoints / Configuration / Savepoints tabs and the savepoint / stop actions (M8) are
 * next slices; operators are a table until the graph lands. A 404 keeps polling (it may be a short gap in HA).
 * The app shell's breadcrumb (D08 "payments-prod / Jobs / name") waits for the shell; the subtitle names the
 * connection meanwhile.
 */
export function JobOverview({
  c,
  jid,
  transport,
  onJobs,
}: {
  c: Connection;
  jid: string;
  transport: (c: Connection) => FlinkHttp;
  onJobs?: () => void;
}) {
  const h1 = useScreenHeading();
  const {
    value: j,
    error,
    banner,
  } = usePolled(c, transport, (http, conn, t) => getJob(http, conn, jid, t), h1, 2_000);
  // Checkpoints on their own poll (5 s, FLINK_API) and their own failures: one widget never blanks the page
  // (ERRORS_AND_ALERTS: "one broken widget does not blank the page"). Its banner is not shown; the KPI says it.
  const ck = usePolled(
    c,
    transport,
    (http, conn, t) => readCkpt(http, conn, jid, t),
    h1,
    POLL.checkpoints.everyMs,
    { quiet: true },
  );
  const cp = ck.value;
  // §4: a single 404 over a job on screen is a blip (HA failover); the page goes only once the banner would.
  const gone = error?.code === 'API-404-JOB' && (!j || !!banner) ? error : null;
  useEffect(() => {
    document.title = `${gone ? 'Job not found' : (j?.name ?? 'Job')} · Stream Lab`;
  }, [j?.name, gone]);
  // The 404 page came or went and took what had focus with it: focus goes to the heading (DoD), not <body>.
  const isGone = !!gone;
  useEffect(() => {
    if (document.activeElement === document.body || !document.activeElement) h1.current?.focus();
  }, [isGone, h1]);
  const p = j ? Math.max(0, ...j.vertices.map((v) => v.parallelism)) : 0;
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {!gone && banner}
      {/* JOB-05 / D08e: a read-only connection hides actions, and says so. */}
      {c.readOnly && !gone && <ErrorBanner error={new AppError('JOB-READONLY')} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
              {gone ? 'Job not found' : (j?.name ?? 'Job')}
            </h1>
            {j && !gone && <StatusBadge tone={TONE[j.state] ?? 'neutral'}>{word(j.state)}</StatusBadge>}
          </div>
          <p className="m-0 text-[14px] text-muted">
            on {c.name}
            {j && !gone && (
              <>
                {' · '}
                <span className="font-mono">{j.jid}</span> · started {ago(j.now - j['start-time'])} ·
                parallelism {p}
              </>
            )}
          </p>
        </div>
        {onJobs && (
          <Button icon={<ListChecks size={16} aria-hidden="true" />} onClick={onJobs}>
            Jobs
          </Button>
        )}
      </div>
      {gone ? (
        <ErrorPage error={gone} icon={SearchX} {...(onJobs ? { onAction: () => onJobs() } : {})} />
      ) : !j ? (
        !banner && (
          <Loading label="Loading job">
            <Skeleton height={56} />
            <Skeleton height={240} />
          </Loading>
        )
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {!cp && ck.error ? (
              <Kpi label="Last checkpoint" value="—" note={present(ck.error).message} />
            ) : cp?.off ? (
              <Kpi
                label="Last checkpoint"
                value="Off"
                note={present(new AppError('JOB-CKPT-NONE')).message}
              />
            ) : ck.stale ? (
              // Stale keeps the last thing known: a failure stays "Failed" (red), never a healthy-looking number.
              <Kpi
                label="Last checkpoint"
                value={
                  cp?.failed.n
                    ? 'Failed'
                    : cp?.last
                      ? `${duration(cp.last.end_to_end_duration)} · ${size(cp.last.checkpointed_size)}`
                      : '—'
                }
                note={`Not answering. Showing data from ${ck.since}.`}
                {...(cp?.failed.n ? { tone: 'error' as const } : {})}
              />
            ) : cp?.failed.n ? (
              <Kpi label="Last checkpoint" value="Failed" note={failedNote(cp.failed)} tone="error" />
            ) : cp?.last ? (
              <Kpi
                label="Last checkpoint"
                value={`${duration(cp.last.end_to_end_duration)} · ${size(cp.last.checkpointed_size)}`}
                note={shortAgo(j.now - cp.last.latest_ack_timestamp)}
                tone="success"
              />
            ) : (
              <Kpi label="Last checkpoint" value="None yet" />
            )}
          </div>
          <Table label="Operators" columns={columns} rows={j.vertices} rowKey={(v) => v.id} />
        </>
      )}
    </main>
  );
}
