import { ErrorPage } from '@sl/errors';
import { getJob, type Connection, type FlinkHttp, type FlinkVertex } from '@sl/flink';
import { Button, Loading, Skeleton, StatusBadge, Table, type Column } from '@sl/ui';
import { ListChecks, SearchX } from 'lucide-react';
import { useEffect } from 'react';
import { useScreenHeading } from './focus';
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
 * ponytail: the job graph (xyflow, D08), the KPIs (records in, watermark lag, last checkpoint, restarts), the
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
  // §4: a single 404 over a job on screen is a blip (HA failover); the page goes only once the banner would.
  const gone = error?.code === 'API-404-JOB' && (!j || !!banner) ? error : null;
  useEffect(() => {
    document.title = `${gone ? 'Job not found' : (j?.name ?? 'Job')} · Stream Lab`;
  }, [j?.name, gone]);
  // The 404 page replaced what had focus: start it at its heading (DoD), not <body>.
  useEffect(() => {
    if (gone && (document.activeElement === document.body || !document.activeElement)) h1.current?.focus();
  }, [gone, h1]);
  const p = j ? Math.max(0, ...j.vertices.map((v) => v.parallelism)) : 0;
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      {!gone && banner}
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
                <span className="font-mono">{j.jid}</span> · started{' '}
                {ago((j.now ?? j['start-time'] + j.duration) - j['start-time'])} · parallelism {p}
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
        <Table label="Operators" columns={columns} rows={j.vertices} rowKey={(v) => v.id} />
      )}
    </main>
  );
}
