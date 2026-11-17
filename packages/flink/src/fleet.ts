import { AppError } from '@sl/errors';
import { ConfigSchema } from './endpoints/config';
import { OverviewSchema } from './endpoints/overview';
import { fromTransport, httpStatusError, TransportError, type FlinkHttp, type FlinkRequest } from './http';
import { z } from 'zod';

/**
 * GET /jobs/overview — every job with its state. Only what the fleet reads.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/rest_api/#jobs-overview
 */
export const JobsOverviewSchema = z.looseObject({
  jobs: z.array(z.looseObject({ jid: z.string(), name: z.string(), state: z.string() })),
});
/** A job in trouble right now (board D04 "Failing"): not FAILED, which is history. */
const FAILING = new Set(['FAILING', 'RESTARTING']);
/**
 * Done jobs. Every other state counts as running in Flink's own overview (jobs-running includes RESTARTING), so
 * both numbers come from /jobs/overview, one snapshot: running = active − failing, as board D04 shows them.
 * FLINK: https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/messages/webmonitor/JobsOverview.java
 */
const DONE = new Set(['FINISHED', 'CANCELED', 'FAILED']);

/** The board's three job groups (D04 fleet card, D07 list chips): one rule, so a cluster gives one answer. */
export type JobBucket = 'running' | 'failing' | 'finished';
export const jobBucket = (state: string): JobBucket =>
  FAILING.has(state) ? 'failing' : DONE.has(state) ? 'finished' : 'running';

/** One fleet card (FLEET-01, board D04): what a cluster says about itself, or why it did not answer (D04b). */
export type FleetStatus =
  | {
      state: 'up';
      version: string;
      /** Jobs not done (Flink's "running", which includes the failing ones): the fleet's job count. */
      jobs: number;
      running: number;
      /** Jobs restarting or failing now. */
      failing: number;
      slotsFree: number;
      slotsTotal: number;
      taskmanagers: number;
    }
  | { state: 'down'; error: AppError };

export async function getJson<S extends z.ZodType>(
  http: FlinkHttp,
  conn: string,
  req: FlinkRequest,
  schema: S,
  verb: string,
) {
  let r;
  try {
    r = await http(req);
  } catch (e) {
    if (e instanceof TransportError) throw fromTransport(e.failure, e);
    if (e instanceof AppError) throw e; // already said in catalog words: keep them
    throw new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);
  }
  if (r.status >= 400) throw httpStatusError(r, conn, verb);
  let body: unknown;
  try {
    body = JSON.parse(r.body);
  } catch (e) {
    throw new AppError('API-SHAPE', {}, e);
  }
  const p = schema.safeParse(body);
  if (!p.success) throw new AppError('API-SHAPE', {}, p.error);
  return p.data as z.infer<S>;
}

/**
 * GET /config, /overview and /jobs/overview for one connection (three of the six in flight a cluster allows; poll() repeats it).
 * Any failure is the card's error: unreachable, refused, signed out, a reply it can not read.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/rest_api/#overview
 */
function counts(states: string[]) {
  const active = states.filter((x) => !DONE.has(x)).length;
  const failing = states.filter((x) => FAILING.has(x)).length;
  return { jobs: active, running: active - failing, failing };
}

export async function fleetStatus(http: FlinkHttp, conn: string, timeoutMs?: number): Promise<FleetStatus> {
  const t = timeoutMs ? { timeoutMs } : {};
  try {
    const [cfg, ov, jobs] = await Promise.all([
      getJson(http, conn, { method: 'GET', path: '/config', ...t }, ConfigSchema, 'reading its version'),
      getJson(http, conn, { method: 'GET', path: '/overview', ...t }, OverviewSchema, 'reading the overview'),
      getJson(
        http,
        conn,
        { method: 'GET', path: '/jobs/overview', ...t },
        JobsOverviewSchema,
        'reading its jobs',
      ),
    ]);
    return {
      state: 'up',
      version: cfg['flink-version'].replace(/^v/i, ''),
      ...counts(jobs.jobs.map((j) => j.state)),
      slotsFree: ov['slots-available'],
      slotsTotal: ov['slots-total'],
      taskmanagers: ov.taskmanagers,
    };
  } catch (e) {
    return { state: 'down', error: e instanceof AppError ? e : new AppError('API-SHAPE', {}, e) };
  }
}
