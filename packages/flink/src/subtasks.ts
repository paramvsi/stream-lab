import { AppError } from '@sl/errors';
import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid/vertices/:vid/subtasks/:i/metrics?get=… — a top-level array of {id, value}, value a String; ids
 * exactly as asked; a metric Flink does not hold is left out (an unknown subtask: []).
 * busyTimeMsPerSecond (Task, ms per second) "Can be NaN, if the value could not be calculated".
 * FLINK: https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/metrics/AbstractMetricsHandler.java
 * FLINK: https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/job/metrics/Metric.java
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/metrics/#io
 */
const MetricsSchema = z.array(z.looseObject({ id: z.string(), value: z.string().optional() }));

export interface SubtaskLoad {
  index: number;
  /** Records in per second; null is no reading. */
  recIn: number | null;
  /** Busy share of each second, 0–100; null is no reading. */
  busy: number | null;
}

export interface SubtaskLoads {
  /** The subtasks read, from 0 (at most MAX_SUBTASKS). */
  loads: SubtaskLoad[];
  /** How many subtasks the vertex has (more than `loads` when capped). */
  total: number;
  /** Reads that failed (their rows are null), with the first error to show: never hidden. */
  failed: { count: number; error: AppError } | null;
}

/** At most this many subtasks are read (one request each); the panel says when there are more. */
export const MAX_SUBTASKS = 32;

const num = (v: string | undefined) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * JOB-03 / board D09c. One subtask at a time (one slot of the connection's 6, like backpressure).
 * ponytail: no State column: Flink has no per-subtask state-size metric (only checkpoint stats); add it from
 * /checkpoints/details/:id/subtasks/:vid if wanted.
 */
export async function getSubtaskLoads(
  http: FlinkHttp,
  conn: string,
  jid: string,
  vid: string,
  parallelism: number,
  timeoutMs = 10_000,
): Promise<SubtaskLoads> {
  const out: SubtaskLoad[] = [];
  let failed: SubtaskLoads['failed'] = null;
  let answered = false;
  const n = Math.min(parallelism, MAX_SUBTASKS);
  for (let index = 0; index < n; index++) {
    const ms = await getJson(
      http,
      conn,
      {
        method: 'GET',
        path: `/jobs/${encodeURIComponent(jid)}/vertices/${encodeURIComponent(vid)}/subtasks/${index}/metrics`,
        query: { get: 'numRecordsInPerSecond,busyTimeMsPerSecond' },
        timeoutMs,
      },
      MetricsSchema,
      'reading subtask metrics',
    ).catch((e: unknown) => {
      // The whole connection is down or refused (CONN-*, 401, 403): every other subtask would fail the same way,
      // one timeout each. Stop now.
      // (Only before anything answered: a timeout after good reads is one slow subtask, counted below.)
      if (!(e instanceof AppError)) throw e;
      const whole = e.code.startsWith('CONN-') || e.code === 'API-401' || e.code === 'API-403';
      if (whole && !answered) throw e;
      failed = { count: (failed?.count ?? 0) + 1, error: failed?.error ?? e };
      return null;
    });
    if (ms) answered = true;
    // One subtask that can not be read is no reading for it alone.
    if (!ms) {
      out.push({ index, recIn: null, busy: null });
      continue;
    }
    const get = (id: string) => num(ms.find((m) => m.id === id)?.value);
    const busy = get('busyTimeMsPerSecond');
    out.push({
      index,
      recIn: get('numRecordsInPerSecond'),
      busy: busy === null ? null : Math.round(busy / 10),
    });
  }
  const f = failed as SubtaskLoads['failed'];
  if (f && f.count === n) throw f.error; // every read failed: an error, not a table of blanks
  return { loads: out, total: parallelism, failed: f };
}

/**
 * Board D09c "Subtask 0 gets 2.8× the records": the busiest subtask against the mean of the others. (The board's
 * own rows give 2.9 this way; its 2.8 is top / second. Product call in MORNING.md.)
 */
export function skew(loads: readonly SubtaskLoad[]): { index: number; times: number } | null {
  if (loads.length < 2 || loads.some((l) => l.recIn === null)) return null;
  const top = loads.reduce((a, b) => (b.recIn! > a.recIn! ? b : a));
  const rest = loads.filter((l) => l !== top);
  const mean = rest.reduce((s, l) => s + l.recIn!, 0) / rest.length;
  if (!mean) return null;
  return { index: top.index, times: Math.round((top.recIn! / mean) * 10) / 10 };
}
