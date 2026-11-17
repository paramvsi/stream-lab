import { AppError, ErrorBanner, ErrorBoundary, ErrorPage, present } from '@sl/errors';
import {
  checkpointingOff,
  getCheckpoints,
  getBackpressure,
  getExceptions,
  getJob,
  jobGraph,
  lastCompleted,
  POLL,
  recentFailures,
  rootCauseLine,
  splitCause,
  type FlinkExceptions,
  type Connection,
  type Backpressure,
  type FlinkCheckpoint,
  type FlinkCheckpointStats,
  type FlinkHttp,
  type FlinkVertex,
} from '@sl/flink';
import { Button, Loading, Skeleton, StatusBadge, Table, Tabs, type Column } from '@sl/ui';
import { ListChecks, SearchX } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useScreenHeading } from './focus';
import { Checkpoints } from './Checkpoints';
import { ExceptionGroups } from './ExceptionGroups';
import { ago, duration, shortAgo, size } from './format';
export { duration, size } from './format';
import { JobGraphView } from './JobGraphView';
import { OperatorPanel } from './OperatorPanel';
import { Kpi } from './Kpi';
import { TONE, uptime, word } from './Jobs';
import { usePolled } from './usePolled';

/**
 * The states with a JOB-05 banner. FAILING is a job that has failed for good and is still cancelling its tasks:
 * Flink takes it only to FAILED (or CANCELLING), never back to RESTARTING, so it is JOB-FAILED too.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/executiongraph/DefaultExecutionGraph.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/scheduler/adaptive/Failing.java
 */
/**
 * Codes that mean the host can not be reached at all: the job poll's banner says those. A timeout or a reset
 * (CONN-IO) can hit one large response while small ones succeed, so on the exceptions read they are its own.
 */
const HOST_DOWN = new Set([
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
const TROUBLED = new Set(['RESTARTING', 'FAILING', 'FAILED']);
/**
 * Flink keeps web.exception-history-size failures per job, 16 by default.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/deployment/config/#web-exception-history-size
 * ponytail: the default, not the cluster's setting; read it from /jobmanager/config if a cluster changes it.
 */
const KEPT = 16;

/**
 * The banner's cause: the message, not the Java class that wraps it (never raw exception text as the message).
 * "pkg.SomeException: text" → "text"; no message → the simple class name.
 */
export const causeText = (line: string) => {
  const { name, message } = splitCause(line);
  return message || name;
};
const DAY = 86_400_000;
/**
 * JOB-05: the job's state as its catalog code (D08c, D11): FAILED or FAILING is JOB-FAILED with the root cause;
 * RESTARTING is JOB-RESTARTING with the failures in the last 24 h (the D08 "Restarts · last 24 h" window) and the
 * newest root cause. Nothing until the exceptions have been read (a banner without its cause would say less).
 */
function statusError(j: { name: string; state: string; now: number }, ex: FlinkExceptions | null) {
  const newest = ex?.entries[0];
  if (!newest) return null;
  // The root cause without its Java class wrapper (Copy details has the full trace).
  const cause = causeText(rootCauseLine(newest));
  if (j.state !== 'RESTARTING')
    return new AppError('JOB-FAILED', { job: j.name, 'root cause first line': cause });
  const recent = recentFailures(ex.entries, j.now, DAY);
  if (!recent.length) return null;
  const oldest = recent[recent.length - 1]!.timestamp;
  // All kept entries are recent and Flink may have dropped more: the count is a lower bound ("16+").
  const capped = recent.length === ex.entries.length && (ex.truncated || ex.entries.length >= KEPT);
  return new AppError('JOB-RESTARTING', {
    job: j.name,
    n: capped ? `${recent.length}+` : recent.length,
    period: uptime(j.now - oldest),
    cause,
  });
}

/**
 * A failed exceptions read, said in one element whatever the code (a change of error keeps it). When it goes, or
 * its code changes (its buttons differ: Retry or not) while focus was in it, the focused button may be gone:
 * focus goes to the heading. Only then: a banner arriving, or one the user never entered, moves nothing.
 */
function ReadError({
  error,
  onRetry,
  heading,
}: {
  error: AppError;
  onRetry: () => void;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const lost = () => document.activeElement === document.body || !document.activeElement;
  useEffect(() => {
    const was = inside.current;
    inside.current = !!box.current?.contains(document.activeElement); // still in it: keep tracking
    if (was && lost()) heading.current?.focus();
  }, [error.code, heading]);
  useEffect(
    () => () => {
      // Unmounted (removed from the DOM by now): focus was in it and fell to <body>.
      if (inside.current && lost()) heading.current?.focus();
    },
    [heading],
  );
  return (
    <div
      ref={box}
      onFocus={() => (inside.current = true)}
      onBlur={(e) => {
        // A blur React sees is the user leaving (none for its own removal), unless the window lost focus.
        if (!e.currentTarget.contains(document.activeElement)) inside.current = false;
      }}
    >
      <ErrorBanner error={error} handles={new Set(['Retry', 'Retry now'])} onAction={onRetry} />
    </div>
  );
}

// ponytail: a fixed bound; a reading's own age on the badge would let it stay longer. Product call in MORNING.md.
/** How old a backpressure reading may be and still be shown (a big job reads its vertices in turn, ~6 per round). */
const BP_MAX_AGE = 60_000;

type Failures = { n: number; more: boolean };
type Ckpt =
  { off: true } | { off: false; last: FlinkCheckpoint | null; failed: Failures; stats: FlinkCheckpointStats };
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
    return { off: false, last: lastCompleted(s), failed: failedInRow(s.history, s.counts.total), stats: s };
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
 * ponytail: the graph's metric colouring (JOB-03), the KPIs records in, watermark lag and restarts (metrics, history), the
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
  // JOB-BACKPRESSURE: each operator of a RUNNING job, on its own quiet 5 s poll (a sample per vertex). One
  // vertex that can not be read is no reading for it alone; Flink's values for a job not running are not read.
  const running = j?.state === 'RUNNING';
  /** Each vertex's last good reading and when it came (cleared when the job or its vertices change). */
  const bpRead = useRef(new Map<string, { value: Backpressure | null; at: number }>());
  const bpNext = useRef(0);
  /** What the graph shows: set by every round, the failed ones too, so an old reading ages out either way. */
  const [bpAged, setBpAged] = useState<Record<string, Backpressure | null>>({});
  const vids = j ? j.vertices.map((v) => v.id).join(',') : '';
  // Bumped when the backpressure read's world changes (state, vertices, page): an older round stops at once.
  const bpGen = useRef(0);
  useEffect(() => {
    const g = bpGen;
    const r = bpRead;
    return () => {
      g.current++;
      r.current.clear();
    };
  }, [running, vids]);
  const bp = usePolled(
    c,
    transport,
    async (http, conn, t) => {
      if (!running || !vids || !j) {
        setBpAged({});
        return {} as Record<string, Backpressure | null>;
      }
      const ids = vids.split(',');
      // One vertex at a time: one slot of the connection's 6, so the job poll never waits behind a burst, and a
      // screen left behind leaves at most one request queued.
      // Bounded: each read at most 2 s (the transport's timeoutMs: FLINK_API, Rust enforces it, so the slot is
      // freed too), the round at most one interval, and it stops as soon as the page moves on. Each round starts
      // where the last one stopped, so on a job too big for one round every vertex is still read in turn.
      const gen = bpGen.current;
      const until = Date.now() + POLL.checkpoints.everyMs;
      const start = bpNext.current % ids.length;
      const order = [...ids.slice(start), ...ids.slice(0, start)];
      const got = new Map<string, PromiseSettledResult<Backpressure | null>>();
      for (const v of order) {
        if (bpGen.current !== gen) throw new Error('stopped');
        if (Date.now() > until) break; // the rest wait for the next round (not a miss: not asked)
        bpNext.current = (ids.indexOf(v) + 1) % ids.length;
        got.set(
          v,
          await getBackpressure(http, conn, jid, v, j.state, Math.min(t, 2_000)).then(
            (value) => {
              // Stamped when it came, and never into a map a restart has cleared since (guard: bp8).
              if (bpGen.current === gen) bpRead.current.set(v, { value, at: Date.now() });
              return { status: 'fulfilled' as const, value };
            },
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
        );
      }
      // A reading counts by its age, not by rounds: shown while under BP_MAX_AGE, whether the vertex was not
      // reached, failed, or sat in a round that failed as a whole (the badges are aged then too, not kept by
      // the poll). Never an old reading that looks current.
      const now = Date.now();
      const aged = Object.fromEntries(
        ids.map((v) => {
          const r = bpRead.current.get(v);
          return [v, r && now - r.at <= BP_MAX_AGE ? r.value : null];
        }),
      );
      setBpAged(aged);
      // §4: every vertex read failing is a failed read (the poll counts it: the stale note), not "all fine".
      const rs = [...got.values()];
      const failed = rs.find((r) => r.status === 'rejected');
      if (failed && rs.every((r) => r.status === 'rejected')) throw failed.reason;
      return aged;
    },
    h1,
    POLL.checkpoints.everyMs,
    { quiet: true, restartOn: running ? vids : '' },
  );
  const bpShown = running ? bpAged : {};
  // JOB-05: exceptions only while the job is in trouble (no extra call for a healthy job), on their own quiet poll.
  const troubled = !!j && TROUBLED.has(j.state);
  const [tab, setTab] = useState('overview');
  // JOB-03: the operator whose panel is open (by id: the job refreshes under it; gone from the job, it closes).
  const [openOp, setOpenOp] = useState<string | null>(null);
  const op = openOp ? j?.vertices.find((v) => v.id === openOp) : undefined;
  // Exceptions are read while the job is in trouble (JOB-05) or the Exceptions tab is open (JOB-08): never for a
  // healthy job nobody is looking at.
  const wantExceptions = troubled || tab === 'exceptions';
  const ex = usePolled(
    c,
    transport,
    (http, conn, t): Promise<FlinkExceptions | null> =>
      wantExceptions ? getExceptions(http, conn, jid, t) : Promise.resolve(null),
    h1,
    POLL.checkpoints.everyMs,
    // The state, not just in/out of trouble: RESTARTING → FAILED reads again at once, naming the final failure.
    { quiet: true, restartOn: wantExceptions ? `${j?.state}|${tab}` : '' },
  );
  const status = j && troubled ? statusError(j, ex.value) : null;
  // Flink keeps only a few failures: when all kept ones may be the tip of more, counts say "N+" (as the banner).
  const exCapped = !!ex.value && (ex.value.truncated || ex.value.entries.length >= KEPT);
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
  // A failed exceptions read says so, under the job poll's own rule (§4): 3 failures in a row, and never while
  // the job poll's banner speaks for the connection. A lost connection (refused, DNS, TLS…) is the job poll's to
  // say, also just after an outage, when this read still holds the outage's error; a timeout on this read alone
  // is its own problem (a large history) and is said. A 404 is said as the HTTP refusal it wraps.
  const exErr =
    ex.error?.code === 'API-404-JOB' && ex.error.cause instanceof AppError ? ex.error.cause : ex.error;
  // The exceptions read's own error, when it is its own (not the connection: the job poll's banner, or a host
  // that can not be reached, says that). Shown once: in the Exceptions tab while it is open (at once: the user is
  // waiting for it), else on the page for a troubled job after 3 in a row (§4).
  const readError = !gone && !banner && !ex.value && exErr && !HOST_DOWN.has(exErr.code) ? exErr : null;
  // The checkpoint read's own error in its tab, under the same rules (not the connection; a 404 as the HTTP
  // refusal it wraps).
  const ckErr =
    ck.error?.code === 'API-404-JOB' && ck.error.cause instanceof AppError ? ck.error.cause : ck.error;
  const ckReadError = !gone && !banner && !cp && ckErr && !HOST_DOWN.has(ckErr.code) ? ckErr : null;
  const onExceptionsTab = tab === 'exceptions';
  const failedRead = !!readError && !onExceptionsTab && troubled && ex.failures >= POLL.jobs.bannerAfter;
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {!gone && banner}
      {/* JOB-02 / D08e: a read-only connection hides actions, and says so. */}
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
      {/* JOB-05: below the job header (D08c). A failed exceptions read says so rather than nothing; losing the
          cluster is the job poll's banner, not a second one. */}
      {!gone && status && <ErrorBanner error={status} handles={new Set()} />}
      {failedRead && readError && <ReadError error={readError} onRetry={ex.retry} heading={h1} />}
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
        <Tabs
          label="Job sections"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: 'overview',
              label: 'Overview',
              content: (
                <ErrorBoundary resetKey={jid}>
                  <div className="flex flex-col gap-5 pt-5">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                      {!cp && ck.error ? (
                        // Its words only when the read's problem is its own (ckReadError's rules); a lost
                        // connection is the page banner's to say.
                        <Kpi
                          label="Last checkpoint"
                          value="—"
                          {...(ckReadError ? { note: present(ckReadError).message } : {})}
                        />
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
                        <Kpi
                          label="Last checkpoint"
                          value="Failed"
                          note={failedNote(cp.failed)}
                          tone="error"
                        />
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
                    <JobGraphView
                      graph={jobGraph(j)}
                      backpressure={bpShown}
                      {...(running && bp.stale
                        ? {
                            note: 'Backpressure: not answering. Badges show readings less than a minute old.',
                          }
                        : {})}
                    />
                    <Table
                      label="Operators"
                      columns={columns}
                      rows={j.vertices}
                      rowKey={(v) => v.id}
                      selectedKey={openOp}
                      onSelect={(v) => setOpenOp(v.id)}
                    />
                    {op && (
                      <OperatorPanel
                        c={c}
                        transport={transport}
                        jid={jid}
                        vertex={op}
                        running={running}
                        heading={h1}
                      />
                    )}
                  </div>
                </ErrorBoundary>
              ),
            },
            {
              value: 'exceptions',
              label: 'Exceptions',
              ...(ex.value ? { count: `${ex.value.entries.length}${exCapped ? '+' : ''}` } : {}),
              content: (
                <ErrorBoundary resetKey={jid}>
                  <div className="pt-5">
                    {ex.value ? (
                      <div className="flex flex-col gap-3">
                        {/* §4: reads failing after a good one keep the groups, and say they are old. */}
                        {ex.stale && (
                          <p className="m-0 text-[13px] text-muted">
                            Not answering. Showing data from {ex.since}.
                          </p>
                        )}
                        <ExceptionGroups entries={ex.value.entries} capped={exCapped} />
                      </div>
                    ) : readError ? (
                      <ReadError error={readError} onRetry={ex.retry} heading={h1} />
                    ) : (
                      <Loading label="Loading exceptions">
                        <Skeleton height={46} />
                      </Loading>
                    )}
                  </div>
                </ErrorBoundary>
              ),
            },
            {
              value: 'checkpoints',
              label: 'Checkpoints',
              content: (
                <ErrorBoundary resetKey={jid}>
                  <div className="pt-5">
                    {cp ? (
                      <div className="flex flex-col gap-3">
                        {/* §4: reads failing after a good one keep the data, and say it is old. */}
                        {ck.stale && (
                          <p className="m-0 text-[13px] text-muted">
                            Not answering. Showing data from {ck.since}.
                          </p>
                        )}
                        {cp.off ? (
                          <Checkpoints off />
                        ) : (
                          <Checkpoints stats={cp.stats} failedInRow={cp.failed} />
                        )}
                      </div>
                    ) : ckReadError ? (
                      <ReadError error={ckReadError} onRetry={ck.retry} heading={h1} />
                    ) : (
                      <Loading label="Loading checkpoints">
                        <Skeleton height={46} />
                      </Loading>
                    )}
                  </div>
                </ErrorBoundary>
              ),
            },
          ]}
        />
      )}
    </main>
  );
}
