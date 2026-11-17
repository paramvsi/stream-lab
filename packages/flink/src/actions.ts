import { AppError } from '@sl/errors';
import { z } from 'zod';
import {
  fromTransport,
  httpStatusError,
  TransportError,
  type FlinkHttp,
  type FlinkRequest,
  type FlinkResponse,
} from './http';

/**
 * ACT-01 / ACT-02 (FLINK_API "Savepoint", "Stop", "Cancel"). Each call is one request, never retried (CLAUDE.md:
 * no automatic retry of a POST; after a timeout the caller reads the job's state first). Trigger, stop and cancel
 * answer 202.
 * Errors as Flink 1.20 sends them (checked in source):
 * - Cancel's 409: "the job has already reached another terminal state (X)" → API-409 with that state.
 * - A trigger or stop with no folder and no cluster default: 400 "Config key [<key>] is not set. Property [...]
 *   must be provided." (key execution.checkpointing.savepoint-dir from 1.20, state.savepoints.dir before) →
 *   SP-DIR-MISSING (the dialog checks /jobmanager/config first; this is the backstop).
 * - ponytail: the savepoint and stop handlers send no conflict signal (1.20 queues a second request; too many
 *   queued fail as TOO_MANY_CHECKPOINT_REQUESTS, shown as SP-FAILED). ACT-05's API-409 there needs a ruling.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/savepoints/SavepointHandlers.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/JobCancellationHandler.java
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

const NO_DIR = /Config key \[(execution\.checkpointing\.savepoint-dir|state\.savepoints\.dir)\] is not set/;

/** One request; transport failures and HTTP errors in catalog words (as getJson), the body kept for its text. */
async function send(
  http: FlinkHttp,
  conn: string,
  req: FlinkRequest,
  verb: string,
  onError?: (r: FlinkResponse) => AppError | null,
) {
  let r: FlinkResponse;
  try {
    r = await http(req);
  } catch (e) {
    if (e instanceof TransportError) throw fromTransport(e.failure, e);
    if (e instanceof AppError) throw e;
    throw new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);
  }
  if (r.status >= 400) throw onError?.(r) ?? httpStatusError(r, conn, verb);
  return r;
}

async function post(http: FlinkHttp, conn: string, job: string, req: FlinkRequest, verb: string) {
  const r = await send(http, conn, req, verb, (r) => {
    if (r.status === 400 && NO_DIR.test(r.body)) return new AppError('SP-DIR-MISSING', {}, r.body);
    return null;
  });
  let body: unknown;
  try {
    body = JSON.parse(r.body);
  } catch (e) {
    throw new AppError('API-SHAPE', {}, e);
  }
  const p = Trigger.safeParse(body);
  if (!p.success) throw new AppError('API-SHAPE', {}, p.error);
  return p.data['request-id'];
}

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
  const r = await send(
    http,
    conn,
    { method: 'GET', path: `/jobs/${encodeURIComponent(jid)}/savepoints/${encodeURIComponent(rid)}` },
    'reading the savepoint',
  );
  let body: unknown;
  try {
    body = JSON.parse(r.body);
  } catch (e) {
    throw new AppError('API-SHAPE', {}, e);
  }
  const p = Status.safeParse(body);
  if (!p.success) throw new AppError('API-SHAPE', {}, p.error);
  const s = p.data;
  if (s.status.id === 'IN_PROGRESS') return { done: false };
  const op = s.operation;
  if (op?.location) return { done: true, location: op.location };
  const cause = op?.['failure-cause'] ?? {};
  return { done: true, error: new AppError('SP-FAILED', { reason: causeText(cause) }, cause) };
}

/** Cancel (no savepoint), behind stop; prod needs type-to-confirm (CANCEL-PROD) in the dialog. */
export async function cancelJob(http: FlinkHttp, conn: string, jid: string, job: string): Promise<void> {
  await send(
    http,
    conn,
    { method: 'PATCH', path: `/jobs/${encodeURIComponent(jid)}`, query: { mode: 'cancel' } },
    'cancelling the job',
    (r) => {
      if (r.status !== 409) return null;
      // "…has already reached another terminal state (FINISHED)."
      const state = /terminal state \((\w+)\)/.exec(r.body)?.[1];
      return new AppError('API-409', { job, state: state ? state.toLowerCase() : 'ended' }, r.body);
    },
  );
}
