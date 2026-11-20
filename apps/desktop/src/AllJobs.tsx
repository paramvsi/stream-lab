import { AppError, ErrorBanner } from '@sl/errors';
import {
  bucketCounts,
  listJobs,
  queryJobs,
  type Connection,
  type FlinkHttp,
  type FlinkJobRow,
  type JobBucket,
} from '@sl/flink';
import { Button, EmptyState, Field, Input, StatusBadge, Table, type Column } from '@sl/ui';
import { Bookmark, Inbox, LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useScreenHeading } from './focus';
import { CHIPS, TONE, word } from './Jobs';
import { EditViewsDialog, SaveViewDialog, type View } from './SavedViews';
import { usePolled } from './usePolled';

type Row = FlinkJobRow & { conn: Connection };

type FeedState = { rows: FlinkJobRow[] | null; error: AppError | null; stale: boolean };

/** One connection's poll. It shows usePolled's banner (or the stale note) only once it has data. */
function Feed({
  c,
  transport,
  heading,
  onState,
  retries,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  heading: RefObject<HTMLHeadingElement | null>;
  onState: (id: string, s: FeedState) => void;
  retries: Map<string, () => void>;
}) {
  const p = usePolled(c, transport, listJobs, heading);
  useEffect(() => {
    retries.set(c.id, p.retry);
  });
  useEffect(
    () => onState(c.id, { rows: p.value, error: p.error, stale: p.stale }),
    [c.id, onState, p.value, p.error, p.stale],
  );
  if (!p.value) return null;
  return (
    p.banner ||
    (p.stale && (
      <p className="m-0 text-[13px] text-muted">
        {c.name} is not answering. Showing its data from {p.since}.
      </p>
    )) ||
    null
  );
}

/**
 * JOB-11 / board X18: the jobs of every connection in one list (Job · Connection · Status). Each connection is a
 * Feed: usePolled (POLL.jobs, through its shared limiter, with ERRORS_AND_ALERTS §4 exactly as on its own
 * screens: stale after 2, CONN-LOST / API-TIMEOUT / the API's own error after 3, over the kept rows, "Back in
 * contact" once, Retry now, focus). Before any data, a failure is FLEET-PARTIAL (X18) with Retry. Until every
 * connection has answered, the screen says how many it is still reading.
 * Saved views (X18, ruled 2026-11-18): Save view names the current search and chip; a view's chip applies them;
 * Edit views renames and deletes.
 * ponytail: views are kept for this session (App state), not on disk; Restarts (1 h) needs per-job reads.
 */
export function AllJobs({
  connections,
  transport,
  onOpenJob,
  onFleet,
  views = [],
  onViews,
}: {
  connections: Connection[];
  transport: (c: Connection) => FlinkHttp;
  onOpenJob: (connId: string, jid: string) => void;
  onFleet?: () => void;
  views?: View[];
  /** Without it, no Save view / Edit views. */
  onViews?: (v: View[]) => void;
}) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Jobs · all connections · Stream Lab';
  }, []);
  const [read, setRead] = useState<Record<string, FeedState>>({});
  const onState = useCallback((id: string, st: FeedState) => setRead((r) => ({ ...r, [id]: st })), []);
  // Each Feed's Retry, for FLEET-PARTIAL's (one stable map for the screen's life).
  const [retries] = useState(() => new Map<string, () => void>());
  // FLEET-PARTIAL can go on its own (a down connection answers on its next poll): focus on it goes to the heading.
  const inPartial = useRef(false);

  const all: Row[] = connections.flatMap((c) => (read[c.id]?.rows ?? []).map((j) => ({ ...j, conn: c })));
  // The Jobs list's own chips and search (D07b), across connections.
  const [bucket, setBucket] = useState<JobBucket | undefined>();
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const activeView = views.find((v) => v.q === q && v.bucket === bucket);
  const counts = bucketCounts(all);
  const rows = queryJobs(all, { ...(bucket ? { bucket } : {}), q });
  // No data and an error: its jobs are missing (FLEET-PARTIAL). With data, each Feed shows its own §4 states.
  const down = connections.filter((c) => !read[c.id]?.rows && !!read[c.id]?.error);
  const stale = connections.filter((c) => !!read[c.id]?.rows && !!read[c.id]?.stale);
  const reading = connections.filter((c) => !read[c.id] || (!read[c.id]!.rows && !read[c.id]!.error)).length;
  // The list is whole only when every connection has answered with fresh jobs: counts and "no match" wait for it
  // (a connection still reading, down or stale may hold the very jobs they would say are not there).
  const whole = !reading && !down.length && !stale.length;
  const retryMissing = () => {
    h1.current?.focus();
    for (const c of down) retries.get(c.id)?.();
  };
  const partialUp = down.length > 0;
  useEffect(() => {
    if (partialUp || !inPartial.current) return;
    inPartial.current = false;
    if (document.activeElement === document.body || !document.activeElement) h1.current?.focus();
  }, [partialUp, h1]);
  const columns: Column<Row>[] = [
    {
      key: 'job',
      header: 'Job',
      render: (r) => (
        <button
          type="button"
          onClick={() => onOpenJob(r.conn.id, r.jid)}
          className="sl-focus cursor-pointer font-medium text-ink underline-offset-2 hover:underline"
        >
          {r.name}
        </button>
      ),
    },
    { key: 'conn', header: 'Connection', render: (r) => r.conn.name },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge tone={TONE[r.state] ?? 'neutral'}>{word(r.state)}</StatusBadge>,
    },
  ];
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
            Jobs
          </h1>
          <p className="m-0 text-[14px] text-muted">
            All connections · {all.length} {all.length === 1 ? 'job' : 'jobs'}
          </p>
        </div>
        <div className="flex gap-3">
          {onViews && (
            <Button icon={<Bookmark size={16} aria-hidden="true" />} onClick={() => setSaving(true)}>
              Save view
            </Button>
          )}
          {onFleet && (
            <Button icon={<LayoutGrid size={16} aria-hidden="true" />} onClick={onFleet}>
              Fleet
            </Button>
          )}
        </div>
      </div>
      {views.length > 0 && (
        <div role="group" aria-label="Saved views" className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={!q && !bucket ? 'secondary' : 'ghost'}
            aria-pressed={!q && !bucket}
            onClick={() => {
              setQ('');
              setBucket(undefined);
            }}
          >
            All
          </Button>
          {views.map((v) => (
            <Button
              key={v.id}
              size="sm"
              variant={activeView?.id === v.id ? 'secondary' : 'ghost'}
              aria-pressed={activeView?.id === v.id}
              onClick={() => {
                setQ(v.q);
                setBucket(v.bucket);
              }}
            >
              {v.name}
            </Button>
          ))}
          {onViews && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit views
            </Button>
          )}
        </div>
      )}
      {saving && onViews && (
        <SaveViewDialog
          taken={views.map((v) => v.name)}
          onClose={() => setSaving(false)}
          onSave={(name) => {
            onViews([...views, { id: crypto.randomUUID(), name, q, ...(bucket ? { bucket } : {}) }]);
            setSaving(false);
          }}
        />
      )}
      {editing && onViews && (
        <EditViewsDialog
          views={views}
          onClose={() => setEditing(false)}
          onDone={(v) => {
            onViews(v);
            setEditing(false);
          }}
        />
      )}
      {partialUp && (
        <div
          onFocus={() => (inPartial.current = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(document.activeElement)) inPartial.current = false;
          }}
        >
          <ErrorBanner
            error={
              new AppError('FLEET-PARTIAL', { n: down.length, names: down.map((c) => c.name).join(', ') })
            }
            handles={new Set(['Retry'])}
            onAction={retryMissing}
          />
        </div>
      )}
      {connections.map((c) => (
        <Feed key={c.id} c={c} transport={transport} heading={h1} onState={onState} retries={retries} />
      ))}
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
              {/* A count only when the list is whole: never "Failing 0" for jobs not read. */}
              {whole ? `${ch.label} ${counts[ch.key]}` : ch.label}
            </Button>
          ))}
        </div>
      </div>
      <p role="status" className={reading ? 'm-0 text-[13px] text-muted' : 'sr-only'}>
        {reading ? `Reading the jobs of ${reading} connection${reading === 1 ? '' : 's'}…` : ''}
      </p>
      {!reading && !all.length && !down.length ? (
        <EmptyState icon={Inbox} title="No jobs on any connection yet" />
      ) : (
        <Table
          label="Jobs on all connections"
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.conn.id}/${r.jid}`}
        />
      )}
      {/* As the Jobs list (D07b): mounted empty so the words are announced, and one step to clear. */}
      <div role="status" className="flex items-center gap-3 text-[14px] text-muted">
        {whole && !!all.length && rows.length === 0 && (!!bucket || !!q.trim()) && (
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
