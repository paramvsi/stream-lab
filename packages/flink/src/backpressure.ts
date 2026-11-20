import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid/vertices/:vid/backpressure — JobVertexBackPressureInfo. `status` is "deprecated" only when Flink
 * holds no metrics for the vertex yet (and for an unknown job or vertex: never a 404); otherwise "ok", which does
 * NOT mean fresh: after a job ends, Flink keeps serving its last values (and `end-timestamp` is the request time).
 * The level is "ok" | "low" | "high" (Flink: max subtask ratio ≤ 0.10, ≤ 0.5, else), written as
 * `backpressureLevel` and, by a hidden getter, `backpressure-level` too; each subtask's share is `ratio` (0–1).
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/JobVertexBackPressureInfo.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/JobVertexBackPressureHandler.java
 */
const Level = z.enum(['ok', 'low', 'high']);
const BackpressureSchema = z.looseObject({
  status: z.string(),
  backpressureLevel: Level.optional(),
  'backpressure-level': Level.optional(),
  subtasks: z
    .array(z.looseObject({ ratio: z.number() }))
    .nullable()
    .optional(),
});

export interface Backpressure {
  level: 'ok' | 'low' | 'high';
  /** The worst subtask's back-pressured share, 0–100 (board D08b "backpressure 97%"). */
  pct: number;
}

/**
 * JOB-BACKPRESSURE (board D08b). Only for a RUNNING job: any other state has no reading (Flink's "ok" would be the
 * last values of a job no longer running), and no request is made. Null too while Flink has no metrics
 * ("deprecated"): no reading, never 0 %.
 */
export async function getBackpressure(
  http: FlinkHttp,
  conn: string,
  jid: string,
  vid: string,
  jobState: string,
  timeoutMs = 10_000,
): Promise<Backpressure | null> {
  if (jobState !== 'RUNNING') return null;
  const r = await getJson(
    http,
    conn,
    {
      method: 'GET',
      path: `/jobs/${encodeURIComponent(jid)}/vertices/${encodeURIComponent(vid)}/backpressure`,
      timeoutMs,
    },
    BackpressureSchema,
    'reading backpressure',
  );
  const level = r.backpressureLevel ?? r['backpressure-level'];
  if (r.status !== 'ok' || !level) return null;
  const worst = Math.max(0, ...(r.subtasks ?? []).map((s) => s.ratio));
  return { level, pct: Math.round(worst * 100) };
}

/**
 * D08f (ruled 2026-11-18: hints from the Flink docs): the likely bottleneck. Flink's guide: backpressure starts at
 * the first operator downstream of the backpressured ones that is not backpressured itself (it is busy, so its
 * inputs wait). Here: an operator reading OK whose input reads HIGH. Without a reading for either, nothing is said.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/monitoring/back_pressure/
 */
export function bottlenecks(
  g: { nodes: readonly { id: string }[]; edges: readonly { from: string; to: string }[] },
  bp: Readonly<Record<string, Backpressure | null | undefined>>,
): string[] {
  return g.nodes
    .filter(
      (n) => bp[n.id]?.level === 'ok' && g.edges.some((e) => e.to === n.id && bp[e.from]?.level === 'high'),
    )
    .map((n) => n.id);
}
