import { AppError } from '@sl/errors';
import { z } from 'zod';
import { getJson } from './fleet';
import { fromTransport, httpStatusError, TransportError, type FlinkHttp, type FlinkRequest } from './http';

/**
 * ACT-01 / ACT-02 (FLINK_API "Savepoint", "Stop", "Cancel"). Each call is one request, never retried (CLAUDE.md:
 * no automatic retry of a POST; after a timeout the caller reads the job's state first).
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/job/savepoints/SavepointTriggerRequestBody.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/job/savepoints/stop/StopWithSavepointRequestBody.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/job/savepoints/SavepointInfo.java
 */
const Trigger = z.looseObject({ 'request-id': z.string() });
const Status = z.looseObject({
  status: z.looseObject({ id: z.enum(['IN_PROGRESS', 'COMPLETED']) }),
  operation: z
    .looseObject({
      location: z.string().nullable().optional(),
      'failure-cause': z
        .looseObject({ class: z.string().optional(), 'stack-trace': z.string().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

/** 409: another operation holds the job (a savepoint or stop already running). */
const conflict = (e: unknown, job: string) =>
  e instanceof AppError && e.code === 'API-4XX' && e.params.status === 409
    ? new AppError('API-409', { job, state: 'busy with another savepoint or stop' }, e)
    : e;

const post = async (http: FlinkHttp, conn: string, job: string, req: FlinkRequest, verb: string) => {
  try {
    return (await getJson(http, conn, req, Trigger, verb))['request-id'];
  } catch (e) {
    throw conflict(e, job);
  }
};

/** Trigger a savepoint, the job keeps running. No folder: the cluster's default (state.savepoints.dir). */
export const triggerSavepoint = (
  http: FlinkHttp,
  conn: string,
  jid: string,
  job: string,
  dir: string | undefined,
) =>
  post(
    http,
    conn,
    job,
    {
      method: 'POST',
      path: `/jobs/${encodeURIComponent(jid)}/savepoints`,
      body: { ...(dir ? { 'target-directory': dir } : {}), 'cancel-job': false },
    },
    'triggering a savepoint',
  );

/** Stop with a savepoint (the default stop, ACT-01); drain sends MAX_WATERMARK first (ends event-time windows). */
export const stopWithSavepoint = (
  http: FlinkHttp,
  conn: string,
  jid: string,
  job: string,
  o: { dir: string | undefined; drain: boolean },
) =>
  post(
    http,
    conn,
    job,
    {
      method: 'POST',
      path: `/jobs/${encodeURIComponent(jid)}/stop`,
      body: { ...(o.dir ? { targetDirectory: o.dir } : {}), drain: o.drain },
    },
    'stopping the job',
  );

export type SavepointState =
  { done: false } | { done: true; location: string } | { done: true; error: AppError };

/** The cause's own words: "Class: message." → "message" (the catalog adds its own full stop). */
const causeText = (c: { class?: string | undefined; 'stack-trace'?: string | undefined }) => {
  const first = (c['stack-trace'] ?? '').split(/\r?\n/)[0] ?? '';
  const msg = first.includes(': ') ? first.slice(first.indexOf(': ') + 2) : '';
  return (msg || c.class?.split('.').at(-1) || 'unknown error').replace(/\.$/, '');
};

/** GET /jobs/:jid/savepoints/:rid: one read (the caller polls, and decides when it is SP-TIMEOUT). */
export async function savepointStatus(
  http: FlinkHttp,
  conn: string,
  jid: string,
  rid: string,
): Promise<SavepointState> {
  const s = await getJson(
    http,
    conn,
    { method: 'GET', path: `/jobs/${encodeURIComponent(jid)}/savepoints/${encodeURIComponent(rid)}` },
    Status,
    'reading the savepoint',
  );
  if (s.status.id === 'IN_PROGRESS') return { done: false };
  const op = s.operation;
  if (op?.location) return { done: true, location: op.location };
  const cause = op?.['failure-cause'] ?? {};
  return { done: true, error: new AppError('SP-FAILED', { reason: causeText(cause) }, cause) };
}

/** Cancel (no savepoint), behind stop; prod needs type-to-confirm (CANCEL-PROD) in the dialog. */
export async function cancelJob(http: FlinkHttp, conn: string, jid: string): Promise<void> {
  let r;
  try {
    r = await http({ method: 'PATCH', path: `/jobs/${encodeURIComponent(jid)}`, query: { mode: 'cancel' } });
  } catch (e) {
    if (e instanceof TransportError) throw fromTransport(e.failure, e);
    if (e instanceof AppError) throw e;
    throw new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);
  }
  if (r.status >= 400) throw httpStatusError(r, conn, 'cancelling the job');
}
