import { AppError, ErrorBanner, present } from '@sl/errors';
import type { FlinkCheckpoint, FlinkCheckpointStats } from '@sl/flink';
import { StatusBadge, Table, type BadgeTone, type Column } from '@sl/ui';
import { duration, size } from './format';
import { Kpi } from './Kpi';

const STATUS: Record<string, [BadgeTone, string]> = {
  COMPLETED: ['success', 'Completed'],
  FAILED: ['error', 'Failed'],
  IN_PROGRESS: ['info', 'In progress'],
};
/** -1 is Flink's "not yet" (an in-progress checkpoint with no acknowledgement); 0 bytes on a failed one too. */
const known = (n: number | undefined) => (n === undefined || n <= 0 ? undefined : n);

const columns: Column<FlinkCheckpoint>[] = [
  { key: 'id', header: 'ID', mono: true, render: (c) => c.id },
  {
    key: 'status',
    header: 'Status',
    render: (c) => {
      const [tone, word] = STATUS[c.status] ?? ['neutral', c.status];
      return <StatusBadge tone={tone}>{word}</StatusBadge>;
    },
  },
  {
    key: 'dur',
    header: 'Duration',
    mono: true,
    render: (c) => (known(c.end_to_end_duration) ? duration(c.end_to_end_duration) : '—'),
  },
  {
    key: 'size',
    header: 'Size',
    mono: true,
    render: (c) => (known(c.checkpointed_size) ? size(c.checkpointed_size) : '—'),
  },
];

/**
 * JOB-12 / boards D12, D12b: the job's checkpoints. Completed and Failed KPIs (failures since the last completed
 * one in red, "N in a row"), JOB-CKPT-FAIL above while failing, the recent history newest first. Off: JOB-CKPT-NONE.
 * ponytail: Duration p95 and Size KPIs need the stats `summary`; the 7 h chart needs JOB-06 history; Slowest
 * operator needs /checkpoints/details/:cid; Flink's counts run since the JobMaster started, not "last 24 h".
 */
export function Checkpoints(
  props:
    { off: true } | { off?: false; stats: FlinkCheckpointStats; failedInRow: { n: number; more: boolean } },
) {
  if (props.off)
    return <p className="m-0 text-[14px] text-muted">{present(new AppError('JOB-CKPT-NONE')).message}</p>;
  const { stats, failedInRow: f } = props;
  const lastFailed = stats.history
    .filter((c) => c.status === 'FAILED' && !c.is_savepoint)
    .sort((a, b) => b.id - a.id)[0];
  const failing =
    f.n > 0 && lastFailed
      ? new AppError('JOB-CKPT-FAIL', {
          id: lastFailed.id,
          dur: known(lastFailed.end_to_end_duration) ? duration(lastFailed.end_to_end_duration) : '—',
          // The catalog's template ends the sentence: no second period.
          reason: (
            (stats.latest?.failed?.id === lastFailed.id && stats.latest.failed.failure_message) ||
            'no reason given'
          ).replace(/\.$/, ''),
        })
      : null;
  // Checkpoints only: savepoints have their own tab, and the KPI and banner leave them out too.
  const history = stats.history.filter((c) => !c.is_savepoint).sort((a, b) => b.id - a.id);
  return (
    <div className="flex flex-col gap-5">
      {failing && <ErrorBanner error={failing} handles={new Set()} />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        <Kpi label="Completed" value={stats.counts.completed.toLocaleString('en-US')} />
        <Kpi
          label="Failed"
          value={stats.counts.failed.toLocaleString('en-US')}
          {...(f.n > 0 ? { note: `${f.n}${f.more ? '+' : ''} in a row`, tone: 'error' as const } : {})}
        />
      </div>
      <Table label="Checkpoints" columns={columns} rows={history} rowKey={(c) => c.id} />
    </div>
  );
}
