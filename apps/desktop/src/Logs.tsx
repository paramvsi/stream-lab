import { AppError, ErrorBanner, present } from '@sl/errors';
import {
  atLeast,
  getJmLog,
  getTmLog,
  LOG_TAIL_LINES,
  listJmLogs,
  listTaskManagers,
  listTmLogs,
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

/** Board D18's process tabs: null is the JobManager, else a TaskManager's id. */
type Proc = string | null;
const listFor = (http: FlinkHttp, conn: string, p: Proc) =>
  p ? listTmLogs(http, conn, p) : listJmLogs(http, conn);
const readFor = (http: FlinkHttp, conn: string, p: Proc, n: string) =>
  p ? getTmLog(http, conn, p, n) : getJmLog(http, conn, n);

/** D18 Follow: how often the shown file is read again. */
export const FOLLOW_MS = 2_000;

const asAppError = (e: unknown, conn: string) =>
  e instanceof AppError ? e : new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);

/**
 * OPS-01 / boards D18, D18b: the JobManager's and TaskManagers' logs. The newest file (listJmLogs first: a file name is never read
 * without the list), its entries (parseLog: Flink's default layout; a stack trace stays with its entry), the level
 * filter (All / Warn / Error) and a plain-text search. Over 50 MB: LOG-TOO-LARGE and the last 5,000 lines. A file
 * gone between list and read: LOG-GONE.
 * Regex search goes through logFilter's bounded worker (LOG-REGEX on the field; LOG-FILTER-FAILED if it breaks).
 * Follow re-reads the shown file every 2 s. Tabs: the JobManager and each TaskManager (by its id).
 * ponytail: Download is the next slice.
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
  // An answer belongs to the parsed content it was computed on (by identity: a Reload with the same name and
  // count is new content) and to its pattern.
  const [found, setFound] = useState<{
    src: object;
    gen: number;
    q: string;
    hits: Set<string> | null;
    error: AppError | null;
  } | null>(null);

  // One load, in order: the list, then the file (the wanted one if still listed, else the newest). A file is never
  // read without a fresh list, a list that fails is not overwritten by a read, and a later load drops an earlier
  // one's answers (req). Used at open, on a pick and on Reload.
  const req = useRef(0);
  /** The size of the file when its shown text was read (Follow reads again only when it changed). */
  const shownSize = useRef<number | undefined>(undefined);
  /** A load (open, pick, Reload) starts a new one; Follow's reads stay in it (the regex answer carries over). */
  const [gen, setGen] = useState(0);
  const [proc, setProc] = useState<Proc>(null);
  const load = useCallback(
    (want: string | null, p: Proc) => {
      const id = ++req.current;
      listFor(http, c.name, p)
        .then((fs) => {
          if (id !== req.current) return;
          setFiles(fs);
          const n = want && fs.some((f) => f.name === want) ? want : (fs[0]?.name ?? null);
          setName(n);
          if (!n) return;
          return readFor(http, c.name, p, n).then((t) => {
            if (id !== req.current) return;
            shownSize.current = fs.find((f) => f.name === n)?.size;
            setText(t);
          });
        })
        .catch((e: unknown) => id === req.current && setError(asAppError(e, c.name)));
    },
    [http, c.name],
  );
  // The tabs' TaskManagers: at open and on Reload. A failure is said; the JobManager's logs still work.
  const [tms, setTms] = useState<string[]>([]);
  const [tmError, setTmError] = useState<AppError | null>(null);
  const tmReq = useRef(0);
  /** The TaskManagers' ids, or null when the list failed (said) or was overtaken by a later one. */
  const loadTms = useCallback((): Promise<string[] | null> => {
    const id = ++tmReq.current;
    return listTaskManagers(http, c.name).then(
      (ts) => {
        if (id !== tmReq.current) return null;
        const ids = ts.map((t) => t.id);
        setTms(ids);
        setTmError(null);
        return ids;
      },
      (e: unknown) => {
        if (id === tmReq.current) setTmError(asAppError(e, c.name));
        return null;
      },
    );
  }, [http, c.name]);
  useEffect(() => {
    void loadTms();
    const r = tmReq;
    return () => {
      r.current++;
    };
  }, [loadTms]);
  useEffect(() => {
    load(null, null);
    const r = req;
    return () => {
      r.current++; // gone: drop what is in flight
    };
  }, [load]);
  const again = (want: string | null, p: Proc = proc) => {
    setGen((g) => g + 1);
    setText(null);
    setError(null);
    setName(want); // the pick holds at once (the picker does not snap back; a failed list keeps it for Reload)
    load(want, p);
  };
  const pickProc = (p: Proc) => {
    procRef.current = p;
    setProc(p);
    setFiles(null);
    again(null, p);
  };
  const procName = useId();
  // Reload: the chosen process again at once, and the TaskManagers alongside. When their list lands, a chosen
  // TaskManager that has left the cluster falls back to the JobManager (never a process with no tab). A list
  // overtaken by a later Reload, or one that failed (said), changes nothing. procRef is what is chosen by then.
  const procRef = useRef<Proc>(null);
  const reload = () => {
    again(name);
    void loadTms().then((ids) => {
      const p = procRef.current;
      if (ids && p && !ids.includes(p)) pickProc(null);
    });
  };

  const file = files?.find((f) => f.name === name) ?? null;

  // D18 Follow, every 2 s, "incremental by size" (FLINK_API): the list again (small), and the file read again only
  // when its size changed (Flink serves a log whole: no partial read). Only while a file is shown (never during a
  // load), one tick at a time, an answer dropped if a load started meanwhile (req). A good tick clears the error; a
  // failed one is said (catalog) and Follow turns off. Off over 50 MB, also when the file grows past it.
  // ponytail: no auto-scroll to the newest line yet; no §4 "1 failure silent" (it stops at once).
  const [follow, setFollow] = useState(false);
  const big = !!file && tooLarge(file.size);
  const ready = text !== null;
  useEffect(() => {
    if (!follow || !name || big || !ready) return;
    let busy = false;
    const t = setInterval(() => {
      if (busy) return;
      busy = true;
      const id = req.current;
      listFor(http, c.name, proc)
        .then((fs) => {
          if (id !== req.current) return;
          const f = fs.find((x) => x.name === name);
          if (!f) throw new AppError('LOG-GONE', { file: name });
          setFiles(fs); // the size and the 50 MB guard stay current (over it, Follow stops: `big`)
          // The error clears once the tick ended well (not before its read: no blink when that read fails too).
          if (tooLarge(f.size) || f.size === shownSize.current) return setError(null);
          return readFor(http, c.name, proc, name).then((t) => {
            if (id !== req.current) return;
            shownSize.current = f.size;
            setText(t);
            setError(null);
          });
        })
        .catch((e: unknown) => {
          if (id !== req.current) return;
          setError(asAppError(e, c.name));
          setFollow(false);
        })
        .finally(() => {
          busy = false;
        });
    }, FOLLOW_MS);
    return () => clearInterval(t);
  }, [follow, name, big, ready, proc, http, c.name]);
  const followWhy = useId();
  // Split and parsed once per file; filtered per level and search.
  const parsed = useMemo(() => {
    if (text === null) return null;
    const { lines, cut } = tail(text, LOG_TAIL_LINES);
    return { cut, entries: parseLog(lines).map((e, i): Row => ({ ...e, i })) };
  }, [text]);
  const joined = (e: LogEntry) => [e.message, ...e.more].join('\n');
  useEffect(() => {
    if (!regex || !q || !parsed) return;
    let live = true;
    const src = parsed;
    filterLinesBounded(parsed.entries.map(joined), q, true, makeWorker).then(
      (lines) => live && setFound({ src, gen, q, hits: new Set(lines), error: null }),
      (e: unknown) =>
        live &&
        setFound({ src, gen, q, hits: null, error: e instanceof AppError ? e : asAppError(e, c.name) }),
    );
    return () => {
      live = false;
    };
  }, [regex, q, parsed, gen, makeWorker, c.name]);
  const answer = regex && q && found?.src === parsed && found.q === q ? found : null;
  // Follow brought new text of the same file (same load): this pattern's last answer stands in until its own, so
  // the table does not flash every line every 2 s (new lines show when the answer lands).
  const carry =
    answer ??
    (regex && q && found && found.gen === gen && found.q === q && found.src !== parsed ? found : null);
  const shown = useMemo(() => {
    if (!parsed) return null;
    const byLevel = parsed.entries.filter(atLeast(level));
    if (regex && q) {
      if (carry) return carry.hits ? byLevel.filter((e) => carry.hits!.has(joined(e))) : [];
      // While this pattern runs: this same content's last answer (an earlier pattern), else this content as it is,
      // never another file's answer (and no flicker to a skeleton on each key).
      const hits = found?.src === parsed ? found.hits : null;
      return hits ? byLevel.filter((e) => hits.has(joined(e))) : byLevel;
    }
    const lq = q.toLowerCase();
    return byLevel.filter((e) => !lq || [e.message, ...e.more].some((l) => l.toLowerCase().includes(lq)));
  }, [parsed, level, q, regex, carry, found]);
  const searchError = carry?.error ?? null;

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
          Logs
        </h1>
        <div className="flex flex-wrap gap-2">
          {/* Always there (also with no files): the list and the file again, e.g. after a rollover. */}
          <Button icon={<RotateCw size={16} aria-hidden="true" />} onClick={reload}>
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
      {tmError && <ErrorBanner error={tmError} />}
      <fieldset className="m-0 flex w-fit flex-wrap gap-1 rounded-md border border-line p-0.5">
        <legend className="sr-only">Process</legend>
        {[null, ...tms].map((p) => (
          <label
            key={p ?? ''}
            className={`cursor-pointer rounded px-3 py-1.5 text-[13px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-rose-600 ${proc === p ? 'bg-subtle text-ink' : 'text-muted'}`}
          >
            <input
              type="radio"
              name={procName}
              checked={proc === p}
              onChange={() => pickProc(p)}
              className="sr-only"
            />
            {p ?? 'JobManager'}
          </label>
        ))}
      </fieldset>
      {file && tooLarge(file.size) && (
        <ErrorBanner error={new AppError('LOG-TOO-LARGE', { size: size(file.size) })} />
      )}
      {files && !files.length ? (
        <p className="m-0 text-[14px] text-muted">No log files on {proc ?? `the JobManager of ${c.name}`}.</p>
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
            <label className="flex items-center gap-2 pb-2 text-[13px] font-medium">
              <input
                type="checkbox"
                role="switch"
                checked={follow && !big}
                disabled={big}
                onChange={(e) => setFollow(e.target.checked)}
                {...(big ? { 'aria-describedby': followWhy } : {})}
                className="sl-focus size-5 accent-rose-600"
              />
              Follow
            </label>
            {big && (
              <span id={followWhy} className="font-normal text-muted">
                Off over 50 MB: each read is the whole file
              </span>
            )}
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
