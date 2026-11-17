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

/** JOB-FAILED "{root cause first line}": the stack trace starts "Name: message"; the name alone if it is empty. */
export const rootCauseLine = (e: Pick<FlinkException, 'exceptionName' | 'stacktrace'>) =>
  e.stacktrace.split('\n', 1)[0]?.trim() || e.exceptionName;

/** Failures at or after `now − windowMs` (JOB-RESTARTING "restarted {n} times in {period}"). */
export const recentFailures = <T extends { timestamp: number }>(
  es: readonly T[],
  now: number,
  windowMs: number,
) => es.filter((e) => e.timestamp >= now - windowMs);
