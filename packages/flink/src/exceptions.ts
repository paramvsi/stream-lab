import { AppError } from '@sl/errors';
import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid/exceptions — JobExceptionsInfoWithHistory. Read `exceptionHistory` only: `root-exception`,
 * `timestamp`, `all-exceptions` and `truncated` at the top level are deprecated (FLINK_API.md). Field names as the
 * Flink 1.20 REST reference lists them. Task fields are optional: a global failure has no task.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobs-jobid-exceptions
 */
const Base = {
  exceptionName: z.string(),
  stacktrace: z.string(),
  timestamp: z.number(),
  taskName: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  taskManagerId: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  failureLabels: z.record(z.string(), z.string()).nullable().optional(),
};
export const ExceptionEntrySchema = z.looseObject({
  ...Base,
  concurrentExceptions: z.array(z.looseObject(Base)).optional(),
});
export const ExceptionsSchema = z.looseObject({
  exceptionHistory: z.looseObject({ entries: z.array(ExceptionEntrySchema), truncated: z.boolean() }),
});
export type FlinkException = z.infer<typeof ExceptionEntrySchema>;
export type FlinkExceptions = z.infer<typeof ExceptionsSchema>['exceptionHistory'];

/** JOB-04 / JOB-08 (board D11): the newest 20 failures (FLINK_API.md: maxExceptions=20). */
export async function getExceptions(
  http: FlinkHttp,
  conn: string,
  jid: string,
  timeoutMs = 10_000,
): Promise<FlinkExceptions> {
  try {
    const r = await getJson(
      http,
      conn,
      {
        method: 'GET',
        path: `/jobs/${encodeURIComponent(jid)}/exceptions`,
        query: { maxExceptions: '20' },
        timeoutMs,
      },
      ExceptionsSchema,
      'reading the exceptions',
    );
    return r.exceptionHistory;
  } catch (e) {
    if (e instanceof AppError && e.code === 'API-4XX' && e.params.status === 404)
      throw new AppError('API-404-JOB', { thing: 'job', conn }, e);
    throw e;
  }
}

/**
 * JOB-FAILED "{root cause first line}" (JOB-04 "root cause first"). Flink's stacktrace is Java's printStackTrace:
 * the outermost wrapper first, then one unindented "Caused by: " line per cause. The root cause is the last of
 * those; indented ones belong to Suppressed blocks. No cause: the first line; an empty trace: the class name.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-core/src/main/java/org/apache/flink/util/ExceptionUtils.java
 */
export const rootCauseLine = (e: Pick<FlinkException, 'exceptionName' | 'stacktrace'>) => {
  const lines = e.stacktrace.split('\n');
  const causes = lines.filter((l) => l.startsWith('Caused by: '));
  const line = causes.length ? causes[causes.length - 1]!.slice('Caused by: '.length) : lines[0];
  return line?.trim() || e.exceptionName;
};

/** Failures at or after `now − windowMs` (JOB-RESTARTING "restarted {n} times in {period}"). */
export const recentFailures = <T extends { timestamp: number }>(
  es: readonly T[],
  now: number,
  windowMs: number,
) => es.filter((e) => e.timestamp >= now - windowMs);

/**
 * A cause line as its simple class name and message: "java.util.concurrent.TimeoutException: Kafka describeTopics"
 * → TimeoutException + "Kafka describeTopics". Java identifiers may be any letter (\p{L}). Plain text that is not
 * "pkg.Class[: message]" is all message.
 */
export function splitCause(line: string): { type: string; name: string; message: string } {
  const t = line.trim();
  const m = /^((?:[\p{L}\p{N}_$]+\.)*([\p{L}\p{N}_$]+))(?:\s*:\s*(.*))?$/u.exec(t);
  // Plain text is kept as it is (the trailing period too): it is not "Class: message".
  if (!m) return { type: '', name: '', message: t };
  return { type: m[1]!, name: m[2]!, message: (m[3] ?? '').replace(/\.$/, '').trim() };
}

/**
 * The grouping form of a message: ids that differ per occurrence become "#" (UUIDs, long hex, and the number
 * after an id word: "Checkpoint 41", "attempt #3", "subtask 2"). Other numbers stay: "status 401" and "status
 * 503" are different problems.
 * ponytail: fixed patterns for what Flink and Kafka put in messages; extend them when a real message splits a
 * group. Partitions ("payments-3") and broker nodes ("node 2") stay apart on purpose: they can be the problem.
 */
const sameProblem = (message: string) =>
  message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '#')
    // Long hex, also inside ids joined by "_" (an ExecutionAttemptID: <graph>_<vertex>_<subtask>_<attempt>).
    .replace(/(?<![0-9a-z])[0-9a-f]{16,}(?:_[0-9a-f]+)*(?![0-9a-z])/gi, '#')
    // The host's IP (pods move); its port only with a TaskManager's resource suffix. A service port stays:
    // :9092 down and :8081 down are different problems.
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '#')
    .replace(/#:\d+-[0-9a-f]+\b/gi, '#:#')
    // Flink's task-name suffix: (subtask/parallelism)#attempt.
    .replace(/\(\d+\/\d+\)(?:#\d+)?/g, '(#)')
    // Counts and durations that change per occurrence (Kafka: "Expiring 5 record(s) … 120001 ms").
    // Not inside a name ("orders-10s"): the number stands on its own.
    .replace(/(?<![\w-])\d+(?=\s*(?:record\(s\)|records?|ms|s|seconds?|bytes?)\b)/gi, '#')
    .replace(
      // One way to match the gap (not "\s*#?\s*"): linear on long whitespace runs.
      /\b(checkpoint|snapshot|savepoint|attempt|subtask|task|partition|id|job)(\s*(?:#\s*)?)\d+/gi,
      '$1$2#',
    );

export interface ExceptionGroup {
  name: string;
  /** The newest occurrence's words. */
  message: string;
  count: number;
  first: number;
  last: number;
  /** Each occurrence, newest first. */
  entries: FlinkException[];
}

/**
 * JOB-08 / board X20: failures collapsed by root cause type and message, most frequent first (ties: most recent
 * first). Per-occurrence ids do not split a group ("Checkpoint 41 / 42 expired"); see sameProblem.
 * ponytail: the 16–20 entries Flink keeps (web.exception-history-size), not all time; JOB-06 history widens it.
 */
export function groupExceptions(entries: readonly FlinkException[]): ExceptionGroup[] {
  const groups = new Map<string, ExceptionGroup>();
  for (const e of [...entries].sort((a, b) => b.timestamp - a.timestamp)) {
    const { type, name, message } = splitCause(rootCauseLine(e));
    // By the full class: two TimeoutExceptions from different packages are different problems.
    const key = `${type}\u0000${sameProblem(message)}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.first = Math.min(g.first, e.timestamp);
      g.last = Math.max(g.last, e.timestamp);
      g.entries.push(e);
    } else groups.set(key, { name, message, count: 1, first: e.timestamp, last: e.timestamp, entries: [e] });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
