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
import { Button, Input, Loading, Skeleton, StatusBadge, Table, type Column } from '@sl/ui';
import { RotateCw, Server } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
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
export function Logs({
  c,
  transport,
  onCluster,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  /** Back to the cluster page. */
  onCluster?: () => void;
}) {
  const h1 = useScreenHeading();
  const http = useMemo(() => transport(c), [transport, c]);
  const [files, setFiles] = useState<LogFile[] | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [level, setLevel] = useState<Level>('all');
  const [query, setQuery] = useState('');
  // Typing stays quick: the filter over up to 5,000 rows follows the typed text a beat behind.
  const q = useDeferredValue(query);
  // Reload: the list again (a file may have rolled over) and the picked file read again.
  const [round, setRound] = useState(0);
  const reload = () => {
    setText(null);
    setError(null);
    setRound((n) => n + 1);
  };
  const levelName = useId();
  const fileId = useId();

  // The list first (a name is never read without it); the newest file is picked.
  useEffect(() => {
    let live = true;
    listJmLogs(http, c.name).then(
      (fs) => {
        if (!live) return;
        setFiles(fs);
        // Keep the picked file if it is still listed; otherwise the newest.
        setName((n) => (n && fs.some((f) => f.name === n) ? n : (fs[0]?.name ?? null)));
      },
      (e: unknown) => live && setError(asAppError(e, c.name)),
    );
    return () => {
      live = false;
    };
  }, [http, c.name, round]);

  // The picked file (picked again from the list after LOG-GONE).
  useEffect(() => {
    if (!name) return;
    let live = true;
    getJmLog(http, c.name, name).then(
      (t) => {
        if (!live) return;
        setText(t);
        setError(null);
      },
      (e: unknown) => live && setError(asAppError(e, c.name)),
    );
    return () => {
      live = false;
    };
  }, [http, c.name, name, round]);

  const file = files?.find((f) => f.name === name) ?? null;
  // Split and parsed once per file; filtered per level and search.
  const parsed = useMemo(() => {
    if (text === null) return null;
    const { lines, cut } = tail(text, LOG_TAIL_LINES);
    return { cut, entries: parseLog(lines).map((e, i): Row => ({ ...e, i })) };
  }, [text]);
  const shown = useMemo(() => {
    if (!parsed) return null;
    const lq = q.toLowerCase();
    return parsed.entries
      .filter(atLeast(level))
      .filter((e) => !lq || [e.message, ...e.more].some((l) => l.toLowerCase().includes(lq)));
  }, [parsed, level, q]);

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
          Logs
        </h1>
        {onCluster && (
          <Button icon={<Server size={16} aria-hidden="true" />} onClick={onCluster}>
            Cluster
          </Button>
        )}
      </div>
      {error && <ErrorBanner error={error} />}
      {file && tooLarge(file.size) && (
        <ErrorBanner error={new AppError('LOG-TOO-LARGE', { size: size(file.size) })} />
      )}
      {files && !files.length ? (
        <p className="m-0 text-[14px] text-muted">No log files on the JobManager of {c.name}.</p>
      ) : (
        <>
          {file && (
            <p className="m-0 text-[14px] text-muted">
              {file.name} · {size(file.size)}
              {/* Said whenever lines were cut, not only over 50 MB (D18: "showing the last N lines"). */}
              {parsed &&
                parsed.cut > 0 &&
                ` · showing the last ${LOG_TAIL_LINES.toLocaleString('en-US')} lines`}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            {files && files.length > 0 && (
              <div className="flex flex-col gap-1">
                <label htmlFor={fileId} className="text-[13px] font-medium">
                  Log file
                </label>
                <select
                  id={fileId}
                  value={name ?? ''}
                  onChange={(e) => {
                    setText(null);
                    setError(null);
                    setName(e.target.value);
                  }}
                  className="sl-focus h-9 rounded-md border border-line bg-surface px-2 text-[14px]"
                >
                  {files.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button icon={<RotateCw size={16} aria-hidden="true" />} onClick={reload}>
              Reload
            </Button>
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
