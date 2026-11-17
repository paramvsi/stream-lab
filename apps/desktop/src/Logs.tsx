import { AppError, ErrorBanner } from '@sl/errors';
import {
  atLeast,
  getJmLog,
  LOG_TAIL_LINES,
  listJmLogs,
  parseLog,
  tail,
  tooLarge,
  type Connection,
  type FlinkHttp,
  type LogEntry,
  type LogFile,
} from '@sl/flink';
import { Input, Loading, Skeleton, StatusBadge, Table, type Column } from '@sl/ui';
import { useEffect, useId, useMemo, useState } from 'react';
import { useScreenHeading } from './focus';
import { size } from './format';

type Level = 'all' | 'warn' | 'error';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];
const TONE: Record<string, 'neutral' | 'warning' | 'error'> = {
  WARN: 'warning',
  ERROR: 'error',
  FATAL: 'error',
};

type Row = LogEntry & { i: number };
const columns: Column<Row>[] = [
  { key: 'time', header: 'Time', mono: true, render: (e) => e.time },
  // The level in words, with a tone (never colour alone).
  {
    key: 'level',
    header: 'Level',
    render: (e) => (e.level ? <StatusBadge tone={TONE[e.level] ?? 'neutral'}>{e.level}</StatusBadge> : ''),
  },
  {
    key: 'message',
    header: 'Message',
    mono: true,
    render: (e) => <span className="whitespace-pre-wrap break-all">{[e.message, ...e.more].join('\n')}</span>,
  },
];

const asAppError = (e: unknown, conn: string) =>
  e instanceof AppError ? e : new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);

/**
 * OPS-01 / boards D18, D18b: the JobManager's logs. The newest file (listJmLogs first: a file name is never read
 * without the list), its entries (parseLog: Flink's default layout; a stack trace stays with its entry), the level
 * filter (All / Warn / Error) and a plain-text search. Over 50 MB: LOG-TOO-LARGE and the last 5,000 lines. A file
 * gone between list and read: LOG-GONE.
 * ponytail: regex search (through logFilter's worker), Follow (re-read every 2 s: Flink has no partial read),
 * TaskManager tabs and Download are next slices.
 */
export function Logs({ c, transport }: { c: Connection; transport: (c: Connection) => FlinkHttp }) {
  const h1 = useScreenHeading();
  const http = useMemo(() => transport(c), [transport, c]);
  const [file, setFile] = useState<LogFile | null>(null);
  const [none, setNone] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [level, setLevel] = useState<Level>('all');
  const [query, setQuery] = useState('');
  const levelName = useId();

  useEffect(() => {
    let live = true;
    listJmLogs(http, c.name)
      .then((files) => {
        if (!live) return;
        const f = files[0];
        if (!f) return setNone(true);
        setFile(f);
        return getJmLog(http, c.name, f.name).then((t) => live && setText(t));
      })
      .catch((e: unknown) => live && setError(asAppError(e, c.name)));
    return () => {
      live = false;
    };
  }, [http, c.name]);

  const shown = useMemo(() => {
    if (text === null) return null;
    const { lines } = tail(text, LOG_TAIL_LINES);
    const q = query.toLowerCase();
    return parseLog(lines)
      .map((e, i): Row => ({ ...e, i }))
      .filter(atLeast(level))
      .filter((e) => !q || [e.message, ...e.more].some((l) => l.toLowerCase().includes(q)));
  }, [text, level, query]);

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
        Logs
      </h1>
      {error && <ErrorBanner error={error} />}
      {file && tooLarge(file.size) && (
        <ErrorBanner error={new AppError('LOG-TOO-LARGE', { size: size(file.size) })} />
      )}
      {none ? (
        <p className="m-0 text-[14px] text-muted">No log files on the JobManager of {c.name}.</p>
      ) : (
        <>
          {file && (
            <p className="m-0 text-[14px] text-muted">
              {file.name} · {size(file.size)}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-72">
              <Input
                type="search"
                aria-label="Search logs"
                placeholder="Search logs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <fieldset className="m-0 flex gap-1 rounded-md border border-line p-0.5">
              <legend className="sr-only">Level</legend>
              {LEVELS.map((l) => (
                <label
                  key={l.value}
                  className={`cursor-pointer rounded px-3 py-1.5 text-[13px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-rose-600 ${level === l.value ? 'bg-subtle text-ink' : 'text-muted'}`}
                >
                  <input
                    type="radio"
                    name={levelName}
                    value={l.value}
                    checked={level === l.value}
                    onChange={() => setLevel(l.value)}
                    className="sr-only"
                  />
                  {l.label}
                </label>
              ))}
            </fieldset>
          </div>
          {shown === null ? (
            !error && (
              <Loading label="Loading the log">
                <Skeleton className="h-64 w-full" />
              </Loading>
            )
          ) : (
            <Table label="Log lines" columns={columns} rows={shown} rowKey={(e) => String(e.i)} />
          )}
        </>
      )}
    </main>
  );
}
