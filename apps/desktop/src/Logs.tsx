import { AppError, ErrorBanner, present } from '@sl/errors';
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
import { Button, Field, Input, Loading, Skeleton, StatusBadge, Table, type Column } from '@sl/ui';
import { RotateCw, Server } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useScreenHeading } from './focus';
import { size } from './format';
import { filterLinesBounded, makeFilterWorker, type FilterWorker } from './logFilter';

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
 * Regex search goes through logFilter's bounded worker (LOG-REGEX on the field; LOG-FILTER-FAILED if it breaks).
 * ponytail: Follow (re-read every 2 s: Flink has no partial read), TaskManager tabs and Download are next slices.
 */
export function Logs({
  c,
  transport,
  onCluster,
  makeWorker = makeFilterWorker,
}: {
  c: Connection;
  transport: (c: Connection) => FlinkHttp;
  /** Back to the cluster page. */
  onCluster?: () => void;
  /** The regex search's worker (tests pass one: jsdom has none). */
  makeWorker?: () => FilterWorker;
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
  const levelName = useId();
  const fileId = useId();
  // D18b regex search: through the bounded worker (a catastrophic pattern can not block the UI). Its answer is
  // kept with the search it answers, and used only while that search and that file are still the ones shown.
  const [regex, setRegex] = useState(false);
  const [found, setFound] = useState<{
    key: string;
    hits: Set<string> | null;
    error: AppError | null;
  } | null>(null);

  // One load, in order: the list, then the file (the wanted one if still listed, else the newest). A file is never
  // read without a fresh list, a list that fails is not overwritten by a read, and a later load drops an earlier
  // one's answers (req). Used at open, on a pick and on Reload.
  const req = useRef(0);
  const load = useCallback(
    (want: string | null) => {
      const id = ++req.current;
      listJmLogs(http, c.name)
        .then((fs) => {
          if (id !== req.current) return;
          setFiles(fs);
          const n = want && fs.some((f) => f.name === want) ? want : (fs[0]?.name ?? null);
          setName(n);
          if (!n) return;
          return getJmLog(http, c.name, n).then((t) => id === req.current && setText(t));
        })
        .catch((e: unknown) => id === req.current && setError(asAppError(e, c.name)));
    },
    [http, c.name],
  );
  useEffect(() => {
    load(null);
    const r = req;
    return () => {
      r.current++; // gone: drop what is in flight
    };
  }, [load]);
  const again = (want: string | null) => {
    setText(null);
    setError(null);
    setName(want); // the pick holds at once (the picker does not snap back; a failed list keeps it for Reload)
    load(want);
  };

  const file = files?.find((f) => f.name === name) ?? null;
  // Split and parsed once per file; filtered per level and search.
  const parsed = useMemo(() => {
    if (text === null) return null;
    const { lines, cut } = tail(text, LOG_TAIL_LINES);
    return { cut, entries: parseLog(lines).map((e, i): Row => ({ ...e, i })) };
  }, [text]);
  const joined = (e: LogEntry) => [e.message, ...e.more].join('\n');
  const searchKey = `${name}|${q}|${parsed ? parsed.entries.length : -1}`;
  useEffect(() => {
    if (!regex || !q || !parsed) return;
    let live = true;
    const key = searchKey;
    filterLinesBounded(parsed.entries.map(joined), q, true, makeWorker).then(
      (lines) => live && setFound({ key, hits: new Set(lines), error: null }),
      (e: unknown) =>
        live && setFound({ key, hits: null, error: e instanceof AppError ? e : asAppError(e, c.name) }),
    );
    return () => {
      live = false;
    };
  }, [regex, q, parsed, searchKey, makeWorker, c.name]);
  const answer = regex && q ? (found?.key === searchKey ? found : null) : null;
  const shown = useMemo(() => {
    if (!parsed) return null;
    const byLevel = parsed.entries.filter(atLeast(level));
    if (regex && q) {
      // While this search runs, the last answer stays on screen (no flicker to a skeleton on each key).
      const hits = answer ? answer.hits : (found?.hits ?? null);
      if (answer && !answer.hits) return [];
      return hits ? byLevel.filter((e) => hits.has(joined(e))) : byLevel;
    }
    const lq = q.toLowerCase();
    return byLevel.filter((e) => !lq || [e.message, ...e.more].some((l) => l.toLowerCase().includes(lq)));
  }, [parsed, level, q, regex, answer, found]);
  const searchError = answer?.error ?? null;

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
          Logs
        </h1>
        <div className="flex flex-wrap gap-2">
          {/* Always there (also with no files): the list and the file again, e.g. after a rollover. */}
          <Button icon={<RotateCw size={16} aria-hidden="true" />} onClick={() => again(name)}>
            Reload
          </Button>
          {onCluster && (
            <Button icon={<Server size={16} aria-hidden="true" />} onClick={onCluster}>
              Cluster
            </Button>
          )}
        </div>
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
                  onChange={(e) => again(e.target.value)}
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
            <div className="w-72">
              <Field label="Search" {...(searchError ? { error: present(searchError).message } : {})}>
                <Input
                  type="search"
                  aria-label="Search logs"
                  placeholder="Search logs"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 pb-2 text-[13px]">
              <input
                type="checkbox"
                checked={regex}
                onChange={(e) => setRegex(e.target.checked)}
                className="sl-focus size-4 accent-rose-600"
              />
              Regex
            </label>
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
