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
import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
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

/** The page's banner says these (connection down or refused); the panel would only repeat it. */
const PAGE_SAYS = (code: string) => code.startsWith('CONN-') || code === 'API-401' || code === 'API-403';

type Props = {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  jid: string;
  vertex: FlinkVertex;
  running: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
};

/**
 * JOB-03 / board D09c: one operator's subtasks (records in / s, busy %) on a quiet 5 s poll while the job runs,
 * with the skew sentence only over a complete table. ponytail: the Metrics and Watermarks tabs (D09, D09b), the
 * State column (no per-subtask metric in Flink) and opening from the graph cards are next slices.
 */
export function OperatorPanel(p: Props) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h3 id={titleId} className="m-0 text-[16px] font-semibold">
        {p.vertex.name}
      </h3>
      {/* Mounted only while the job runs (no reads otherwise), fresh per operator (never the last one's rows). */}
      {p.running ? (
        <Subtasks key={p.vertex.id} {...p} />
      ) : (
        <p className="m-0 text-[14px] text-muted">Subtask metrics are read while the job runs.</p>
      )}
    </section>
  );
}

function Subtasks({ c, transport, jid, vertex, heading }: Props) {
  // Closed, switched or the job stopped: the round in flight sends nothing more. (Nothing in here takes focus,
  // so its going loses none: no Retry, the table neither scrolls nor selects.)
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  const sub = usePolled(
    c,
    transport,
    (http, conn, t) => getSubtaskLoads(http, conn, jid, vertex.id, vertex.parallelism, t, () => gone.current),
    heading,
    5_000,
    { quiet: true },
  );
  const v = sub.value;
  const sk = v && !v.failed && v.loads.length === v.total ? skew(v.loads) : null;
  const err = !v && sub.error && !PAGE_SAYS(sub.error.code) ? sub.error : null;
  return (
    <div className="flex flex-col gap-3">
      {!v ? (
        err ? (
          <Problem>Subtasks could not be read: {present(err).message}</Problem>
        ) : (
          <Loading label="Loading subtasks">
            <Skeleton className="h-24 w-full" />
          </Loading>
        )
      ) : (
        <>
          {sub.stale && (
            <p className="m-0 text-[13px] text-muted">Not answering. Showing data from {sub.since}.</p>
          )}
          {v.failed && (
            <Problem>
              {v.failed.count} subtask{v.failed.count === 1 ? '' : 's'} could not be read:{' '}
              {present(v.failed.error).message}
            </Problem>
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
    </div>
  );
}

/** Words + icon, never colour alone. */
function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-1.5 text-[13px] text-danger-600">
      <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
      <span>{children}</span>
    </p>
  );
}
