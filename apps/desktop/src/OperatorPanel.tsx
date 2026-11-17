import { present } from '@sl/errors';
import {
  getSubtaskLoads,
  getWatermarks,
  holdingBack,
  skew,
  type Connection,
  type FlinkHttp,
  type FlinkVertex,
  type SubtaskLoad,
  type SubtaskWatermark,
} from '@sl/flink';
import { Loading, Skeleton, Table, Tabs, type Column } from '@sl/ui';
import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Explain } from './Explain';
import { HOST_DOWN, usePolled } from './usePolled';

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

type Props = {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  jid: string;
  vertex: FlinkVertex;
  running: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  /** The page's own banner is up: it says the outage, the panel does not say it again. */
  pageBanner: boolean;
  /** The JobManager's clock (the job read's `now`): watermark lag is measured against it. */
  now: number;
  /** A source (by Flink's plan): Flink keeps no input watermark for it (SourceOperatorStreamTask registers none). */
  source: boolean;
  /** It feeds other operators (where its watermarks show). */
  feeds: boolean;
  /** Fed from a source point-to-point only: one lagging subtask may be an idle source partition (see JobOverview). */
  idleCanHold: boolean;
};

/**
 * JOB-03 / boards D09c and D09b: one operator's Subtasks (records in / s, busy %; the skew sentence only over a
 * complete table) and Watermarks (each subtask's input watermark and lag; the one holding the operator back),
 * each on a quiet 5 s poll while the job runs and its tab is open (Radix unmounts the other).
 * ponytail: the Metrics tab (D09, charts), and the State column (no per-subtask metric in Flink) are next slices.
 */
export function OperatorPanel(p: Props) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      {/* h2: a section of the job page beside "Job graph", not one of its operator cards. */}
      <h2 id={titleId} className="m-0 text-[16px] font-semibold">
        {p.vertex.name}
      </h2>
      {/* Each tab's reads are mounted only while the job runs (no reads otherwise), fresh per operator (never the
          last one's rows). */}
      <Tabs
        label={`${p.vertex.name} sections`}
        items={[
          {
            value: 'subtasks',
            label: 'Subtasks',
            content: <Running {...p}>{<Subtasks key={p.vertex.id} {...p} />}</Running>,
          },
          {
            value: 'watermarks',
            label: 'Watermarks',
            content: <Running {...p}>{<Watermarks key={p.vertex.id} {...p} />}</Running>,
          },
        ]}
      />
    </section>
  );
}

function Subtasks({ c, transport, jid, vertex, heading, pageBanner }: Props) {
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
  // As the exceptions and checkpoint reads: a host down is the job poll's to say, also around its banner (before
  // it is up, after it goes while this read still holds the outage); a timeout or reset on this read is its own.
  const err = !v && sub.error && !pageBanner && !HOST_DOWN.has(sub.error.code) ? sub.error : null;
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

function Running({ running, children }: Props & { children: ReactNode }) {
  return (
    <div className="pt-3">
      {running ? (
        children
      ) : (
        <p className="m-0 text-[14px] text-muted">Subtask metrics are read while the job runs.</p>
      )}
    </div>
  );
}

/** Seconds as the board writes them: "41 s", "3 min 20 s". */
const lagText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
};
const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

function Watermarks(p: Props) {
  if (p.source)
    return (
      <p className="m-0 text-[14px] text-muted">
        A source has no input watermark.
        {p.feeds ? ' Its watermarks show on the operators it feeds.' : ''}
      </p>
    );
  return <WatermarkTable {...p} />;
}

// FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/streaming/runtime/tasks/SourceOperatorStreamTask.java
function WatermarkTable({ c, transport, jid, vertex, heading, pageBanner, now, idleCanHold }: Props) {
  // JOB-10: once a subtask has held the watermark back, "Explain watermarks" stays while this tab is open.
  const [explain, setExplain] = useState(false);
  // The JobManager's time at the moment of each watermark read: the last job read's `now`, plus the time since it
  // came. Lag is fixed at the read, never against a later job read (it would swing with the two polls).
  const base = useRef({ jm: now, at: 0 });
  useEffect(() => {
    base.current = { jm: now, at: Date.now() };
  }, [now]);
  const wm = usePolled(
    c,
    transport,
    async (http, conn, t) => {
      const rows = await getWatermarks(http, conn, jid, vertex.id, vertex.parallelism, t);
      const b = base.current;
      return { rows, jmNow: b.jm + (b.at ? Date.now() - b.at : 0) };
    },
    heading,
    5_000,
    { quiet: true },
  );
  const read = wm.value;
  const v = read?.rows ?? null;
  const err = !v && wm.error && !pageBanner && !HOST_DOWN.has(wm.error.code) ? wm.error : null;
  if (!v)
    return err ? (
      <Problem>Watermarks could not be read: {present(err).message}</Problem>
    ) : (
      <Loading label="Loading watermarks">
        <Skeleton className="h-24 w-full" />
      </Loading>
    );
  const held = holdingBack(v);
  if (held && !explain) setExplain(true);
  const cols: Column<SubtaskWatermark>[] = [
    { key: 'i', header: '#', mono: true, render: (w) => w.index },
    {
      key: 'w',
      header: 'Watermark',
      mono: true,
      render: (w) => (w.ended ? 'Input ended' : w.at === null ? 'No watermark yet' : timeOf(w.at)),
    },
    {
      key: 'lag',
      header: 'Lag',
      mono: true,
      align: 'right',
      render: (w) => {
        if (w.at === null || !read) return '—';
        const ms = read.jmNow - w.at;
        // An event-time watermark can run ahead of the clock: said, never shown as 0.
        const lag = ms <= -500 ? `${lagText(-ms)} ahead` : lagText(ms);
        return `${lag}${held?.index === w.index ? ' · holding back' : ''}`;
      },
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {wm.stale && <p className="m-0 text-[13px] text-muted">Not answering. Showing data from {wm.since}.</p>}
      <Table label="Watermarks" columns={cols} rows={v} rowKey={(w) => String(w.index)} />
      {/* FLINK: MetricFetcherImpl refreshes at most every metrics.fetcher.update-interval (10 s by default). */}
      <p className="m-0 text-[13px] text-muted">
        Flink refreshes these values about every 10 s, so a lag can read up to 10 s high.
      </p>
      {held && (
        <p className="m-0 text-[14px]">
          Subtask {held.index} is {lagText(held.behindMs)} behind the others, so the operator's watermark
          waits for it.{' '}
          {idleCanHold
            ? 'Its source partition may be idle: consider an idleness timeout.'
            : 'Check whether it is busy or gets more records than the others (Subtasks).'}
        </p>
      )}
      {explain && (
        <div className="flex">
          <Explain term="watermark" label="Explain watermarks" />
        </div>
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
