import { EmptyState, Table, type Column } from '@sl/ui';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clock } from './ExceptionGroups';
import type { HistoryEvent, HistoryStore } from './history';

const WORD: Record<HistoryEvent['kind'], string> = { restart: 'Restart', rescale: 'Rescaled' };

const columns: Column<HistoryEvent>[] = [
  { key: 'at', header: 'When', mono: true, render: (e) => clock(e.at) },
  { key: 'kind', header: 'Event', render: (e) => WORD[e.kind] },
  { key: 'detail', header: 'Detail', render: (e) => e.detail },
];

/**
 * JOB-06 / board D10: the job's local timeline, newest first, from what this computer recorded while the job page
 * was open (`version` changes when something new is recorded).
 * ponytail: the chart (records in, watermark lag; uPlot), the 1 h / 24 h / 7 d range, the grey "closed" bands and
 * rows (needs an app-wide session recorder), and recording while the job page is closed are next slices.
 */
export function JobHistory({
  history,
  conn,
  jid,
  version,
}: {
  history: HistoryStore;
  conn: string;
  jid: string;
  version: number;
}) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    void history.events(conn, jid).then((e) => live && setEvents(e));
    return () => {
      live = false;
    };
  }, [history, conn, jid, version]);
  return (
    <div className="flex flex-col gap-3 pt-5">
      <p className="m-0 text-[13px] text-muted">Recorded on this computer while Stream Lab was open.</p>
      {events === null ? null : events.length ? (
        <Table
          label="Timeline"
          columns={columns}
          rows={events}
          rowKey={(e) => `${e.at}-${e.kind}-${e.detail}`}
        />
      ) : (
        <EmptyState icon={History} title="Nothing recorded yet" level={3}>
          Restarts and rescales show here as they happen while this page is open.
        </EmptyState>
      )}
    </div>
  );
}
