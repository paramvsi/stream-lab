import { AppError, cleanCause, present } from '@sl/errors';
import { Table, type Column } from '@sl/ui';
import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { clock } from './ExceptionGroups';
import type { HistoryEvent, HistoryStore } from './history';

const WORD: Record<HistoryEvent['kind'], string> = { restart: 'Restart', rescale: 'Rescaled' };

/** Board D10's event pills: Restart in danger red, Rescaled in rose; a dot and the word (never colour alone). */
const PILL: Record<HistoryEvent['kind'], string> = {
  restart: 'bg-danger-50 text-danger-600',
  rescale: 'bg-rose-50 text-rose-700',
};
const Pill = ({ kind }: { kind: HistoryEvent['kind'] }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-[12px] font-medium ${PILL[kind]}`}
  >
    <span aria-hidden="true" className="size-1.5 rounded-pill bg-current" />
    {WORD[kind]}
  </span>
);

const columns: Column<HistoryEvent>[] = [
  { key: 'at', header: 'When', mono: true, render: (e) => clock(e.at) },
  { key: 'kind', header: 'Event', render: (e) => <Pill kind={e.kind} /> },
  { key: 'detail', header: 'Detail', render: (e) => e.detail },
];

const reasonOf = (e: unknown) => cleanCause(e instanceof Error ? e.message : String(e));

/**
 * JOB-06 / board D10: the job's local timeline, newest first, from what this computer recorded while the job page
 * was open (`version` changes when something new is recorded). A store that fails says HISTORY-IO.
 * ponytail: the chart (records in, watermark lag; uPlot), the 1 h / 24 h / 7 d range, the grey "closed" bands and
 * rows (needs an app-wide session recorder), and recording while the job page is closed are next slices.
 */
export function JobHistory({
  history,
  conn,
  jid,
  version,
  saveError = null,
}: {
  history: HistoryStore;
  conn: string;
  jid: string;
  version: number;
  /** The last write failed (the page tries it again with the next read). */
  saveError?: AppError | null;
}) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [readError, setReadError] = useState<AppError | null>(null);
  const titleId = useId();
  useEffect(() => {
    let live = true;
    history.events(conn, jid).then(
      (e) => {
        if (!live) return;
        setEvents(e);
        setReadError(null);
      },
      (e: unknown) =>
        live && setReadError(new AppError('HISTORY-IO', { action: 'read', reason: reasonOf(e) }, e)),
    );
    return () => {
      live = false;
    };
  }, [history, conn, jid, version]);
  const problem = readError ?? saveError;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 pt-5">
      <h3 id={titleId} className="m-0 text-[16px] font-semibold">
        Timeline
      </h3>
      <p className="m-0 text-[13px] text-muted">Recorded on this computer while Stream Lab was open.</p>
      {problem && (
        <p className="m-0 flex items-center gap-1.5 text-[13px] text-danger-600">
          <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
          <span>{present(problem).message}</span>
        </p>
      )}
      {events === null ? null : events.length ? (
        <Table
          label="Timeline"
          columns={columns}
          rows={events}
          rowKey={(e) => `${e.at}-${e.kind}-${e.detail}`}
        />
      ) : (
        <p className="m-0 text-[14px] text-muted">
          Nothing recorded yet. Restarts and rescales show here as they happen while this page is open.
        </p>
      )}
    </section>
  );
}
