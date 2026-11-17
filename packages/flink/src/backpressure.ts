import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid/vertices/:vid/backpressure — JobVertexBackPressureInfo. `status` is "ok" or "deprecated" (no
 * fresh sample yet); the level is "ok" | "low" | "high", written as `backpressureLevel` and, by a hidden getter,
 * `backpressure-level` too; each subtask's back-pressured share is `ratio` (a double, 0–1).
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/messages/JobVertexBackPressureInfo.java
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

/** JOB-BACKPRESSURE (board D08b). Null while Flink has no fresh sample ("deprecated"): no reading, never 0 %. */
export async function getBackpressure(
  http: FlinkHttp,
  conn: string,
  jid: string,
  vid: string,
  timeoutMs = 10_000,
): Promise<Backpressure | null> {
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
