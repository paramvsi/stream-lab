import { present } from '@sl/errors';
import {
  getSubtaskLoads,
  skew,
  type Connection,
  type FlinkHttp,
  type FlinkVertex,
  type SubtaskLoad,
} from '@sl/flink';
import { Loading, Skeleton, Table, type Column } from '@sl/ui';
import { useId, type RefObject } from 'react';
import { usePolled } from './usePolled';

const columns: Column<SubtaskLoad>[] = [
  { key: 'i', header: '#', mono: true, render: (l) => l.index },
  {
    key: 'in',
    header: 'Records in',
    mono: true,
    align: 'right',
    render: (l) => (l.recIn === null ? '—' : `${Math.round(l.recIn).toLocaleString('en-US')}/s`),
  },
  {
    key: 'busy',
    header: 'Busy',
    mono: true,
    align: 'right',
    render: (l) => (l.busy === null ? '—' : `${l.busy}%`),
  },
];

/** A skew worth a sentence (board D09c "Subtask 0 gets 2.8× the records"). ponytail: fixed; tune with real jobs. */
const SKEW_SAID = 2;

/**
 * JOB-03 / board D09c: one operator's subtasks (records in / s, busy %) on a quiet 5 s poll while the job runs,
 * with the skew sentence only over a complete table. ponytail: the Metrics and Watermarks tabs (D09, D09b), the
 * State column (no per-subtask metric in Flink) and opening from the graph cards are next slices.
 */
export function OperatorPanel({
  c,
  transport,
  jid,
  vertex,
  running,
  heading,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  jid: string;
  vertex: FlinkVertex;
  running: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const titleId = useId();
  const sub = usePolled(
    c,
    transport,
    (http, conn, t) => getSubtaskLoads(http, conn, jid, vertex.id, vertex.parallelism, t),
    heading,
    5_000,
    { quiet: true, restartOn: `${vertex.id}|${running}` },
  );
  const v = sub.value;
  const sk = v && !v.failed && v.loads.length === v.total ? skew(v.loads) : null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h3 id={titleId} className="m-0 text-[16px] font-semibold">
        {vertex.name}
      </h3>
      {!running ? (
        <p className="m-0 text-[14px] text-muted">Subtask metrics are read while the job runs.</p>
      ) : !v ? (
        (sub.banner ?? (
          <Loading label="Loading subtasks">
            <Skeleton className="h-24 w-full" />
          </Loading>
        ))
      ) : (
        <>
          {sub.stale && (
            <p className="m-0 text-[13px] text-muted">Not answering. Showing data from {sub.since}.</p>
          )}
          {v.failed && (
            <p className="m-0 text-[13px] text-danger-600">
              {v.failed.count} subtask{v.failed.count === 1 ? '' : 's'} could not be read:{' '}
              {present(v.failed.error).message}
            </p>
          )}
          <Table label="Subtasks" columns={columns} rows={v.loads} rowKey={(l) => String(l.index)} />
          {v.total > v.loads.length && (
            <p className="m-0 text-[13px] text-muted">
              Showing the first {v.loads.length} of {v.total} subtasks.
            </p>
          )}
          {sk && sk.times >= SKEW_SAID && (
            <p className="m-0 text-[14px]">
              Subtask {sk.index} gets {sk.times}× the records
            </p>
          )}
        </>
      )}
    </section>
  );
}
