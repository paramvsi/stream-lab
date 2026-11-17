import { AppError } from '@sl/errors';
import { z } from 'zod';
import { getJson } from './fleet';
import { fromTransport, httpStatusError, TransportError, type FlinkHttp, type FlinkResponse } from './http';

/**
 * OPS-01 / board D18: JobManager logs. GET /jobmanager/logs is LogListInfo {logs: [{name, size, mtime}]} (size and
 * mtime from java.io.File: bytes, epoch ms; regular files only). GET /jobmanager/logs/:name serves the whole file
 * as text/plain (no Range, no offset: "follow" reads the file again; FLINK_API polls it every 2 s); a name that
 * is not there is 404.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/LogListInfo.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/cluster/AbstractJobManagerFileHandler.java
 * TaskManager logs: /taskmanagers/:taskmanagerid/logs and /taskmanagers/:taskmanagerid/logs/:filename
 * (TaskManagerLogsHeaders, TaskManagerCustomLogHeaders, release-1.20).
 */
const LogList = z.looseObject({
  logs: z.array(z.looseObject({ name: z.string(), size: z.number(), mtime: z.number() })),
});
export type LogFile = { name: string; size: number; mtime: number };

/** The JobManager's log files, newest first. */
export async function listJmLogs(http: FlinkHttp, conn: string, timeoutMs = 10_000): Promise<LogFile[]> {
  const r = await getJson(
    http,
    conn,
    { method: 'GET', path: '/jobmanager/logs', timeoutMs },
    LogList,
    'listing its logs',
  );
  return r.logs.map(({ name, size, mtime }) => ({ name, size, mtime })).sort((a, b) => b.mtime - a.mtime);
}

/** One JobManager log file's text (the whole file: Flink has no partial read). */
export const getJmLog = (http: FlinkHttp, conn: string, name: string, timeoutMs = 30_000) =>
  getText(
    http,
    conn,
    `/jobmanager/logs/${encodeURIComponent(name)}`,
    timeoutMs,
    name,
    (r) => r.status === 404,
  );

/** A plain-text GET in catalog words (transport and HTTP errors as getJson gives them). */
async function getText(
  http: FlinkHttp,
  conn: string,
  path: string,
  timeoutMs: number,
  file: string,
  /** How this process says the file is not there (LOG-GONE): JobManager 404, TaskManager 500 with its text. */
  gone: (r: FlinkResponse) => boolean,
): Promise<string> {
  let r;
  try {
    r = await http({ method: 'GET', path, timeoutMs });
  } catch (e) {
    if (e instanceof TransportError) throw fromTransport(e.failure, e);
    if (e instanceof AppError) throw e;
    throw new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);
  }
  if (r.status >= 400 && gone(r)) throw new AppError('LOG-GONE', { file }, r.body);
  if (r.status >= 400) throw httpStatusError(r, conn, 'reading a log');
  return r.body;
}

/** A TaskManager's log files, newest first (/taskmanagers/:taskmanagerid/logs, the same LogListInfo). */
export async function listTmLogs(
  http: FlinkHttp,
  conn: string,
  tm: string,
  timeoutMs = 10_000,
): Promise<LogFile[]> {
  const r = await getJson(
    http,
    conn,
    { method: 'GET', path: `/taskmanagers/${encodeURIComponent(tm)}/logs`, timeoutMs },
    LogList,
    'listing its logs',
  );
  return r.logs.map(({ name, size, mtime }) => ({ name, size, mtime })).sort((a, b) => b.mtime - a.mtime);
}

/** One TaskManager log file's text (/taskmanagers/:taskmanagerid/logs/:filename). */
// FLINK: TaskExecutor throws FileNotFoundException "…does not exist on the TaskExecutor.", which the handler sends as
// a 500 (AbstractTaskManagerFileHandler, release-1.20). An unknown TaskManager is a 404 (kept as API-4XX).
export const getTmLog = (http: FlinkHttp, conn: string, tm: string, name: string, timeoutMs = 30_000) =>
  getText(
    http,
    conn,
    `/taskmanagers/${encodeURIComponent(tm)}/logs/${encodeURIComponent(name)}`,
    timeoutMs,
    name,
    (r) => r.status >= 500 && r.body.includes('does not exist on the TaskExecutor'),
  );

/** LOG-TOO-LARGE: over 50 MB, only the last lines are shown. */
export const LOG_TOO_LARGE_BYTES = 50 * 1024 * 1024;
export const LOG_TAIL_LINES = 5_000;
export const tooLarge = (size: number) => size > LOG_TOO_LARGE_BYTES;

/** The last `n` lines (and how many were cut). A final line end is not a line. */
export function tail(text: string, n: number): { lines: string[]; cut: number } {
  const all = text.split(/\r?\n/);
  if (all.at(-1) === '') all.pop();
  const cut = Math.max(0, all.length - n);
  return { lines: all.slice(cut), cut };
}

/**
 * D18 filter: plain text matches case-insensitively; as a regex, an invalid pattern is LOG-REGEX (field).
 * ponytail: synchronous, so a user regex with catastrophic backtracking ("(a+)+$") can block for seconds per line.
 * The D18 screen must run it in a Worker with a time limit (not on the UI thread); recorded for that slice.
 */
export function filterLines(lines: readonly string[], pattern: string, regex: boolean): string[] {
  if (!pattern) return [...lines];
  if (!regex) {
    const p = pattern.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(p));
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    throw new AppError('LOG-REGEX', { reason: e instanceof Error ? e.message : String(e) }, e);
  }
  return lines.filter((l) => re.test(l));
}
