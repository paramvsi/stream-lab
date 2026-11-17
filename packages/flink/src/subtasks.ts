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
): Promise<SubtaskLoad[]> {
  const out: SubtaskLoad[] = [];
  for (let index = 0; index < parallelism; index++) {
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
    );
    const get = (id: string) => num(ms.find((m) => m.id === id)?.value);
    const busy = get('busyTimeMsPerSecond');
    out.push({
      index,
      recIn: get('numRecordsInPerSecond'),
      busy: busy === null ? null : Math.round(busy / 10),
    });
  }
  return out;
}

/** Board D09c "Subtask 0 gets 2.8× the records": the busiest subtask against the mean of the others. */
export function skew(loads: readonly SubtaskLoad[]): { index: number; times: number } | null {
  if (loads.length < 2 || loads.some((l) => l.recIn === null)) return null;
  const top = loads.reduce((a, b) => (b.recIn! > a.recIn! ? b : a));
  const rest = loads.filter((l) => l !== top);
  const mean = rest.reduce((s, l) => s + l.recIn!, 0) / rest.length;
  if (!mean) return null;
  return { index: top.index, times: Math.round((top.recIn! / mean) * 10) / 10 };
}
