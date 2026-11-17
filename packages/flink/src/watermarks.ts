import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid/vertices/:vid/watermarks — the same {id, value: String} array as the metrics handlers, one
 * "<subtaskIndex>.currentInputWatermark" per subtask that has the metric (others left out). One value per subtask
 * of this vertex: not per upstream input. The value is ms ("The last watermark this operator/tasks has
 * received"); the gauge starts at Long.MIN_VALUE (no watermark yet), and the end of a bounded input is
 * Watermark.MAX_WATERMARK (Long.MAX_VALUE, "end-of-event-time"): neither is a time; the first is no watermark yet,
 * the second `ended`.
 * FLINK: https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/metrics/JobVertexWatermarksHandler.java
 * FLINK: https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/streaming/runtime/metrics/WatermarkGauge.java
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/metrics/#io
 */
// FLINK: https://github.com/apache/flink/blob/master/flink-runtime/src/main/java/org/apache/flink/streaming/api/watermark/Watermark.java
const Schema = z.array(z.looseObject({ id: z.string(), value: z.string().optional() }));

export interface SubtaskWatermark {
  index: number;
  /** Event time in ms; null is no watermark yet, or ended. */
  at: number | null;
  /** Its input has ended (Watermark.MAX_WATERMARK: "end-of-event-time"). */
  ended: boolean;
}

/** JOB-03 / board D09b: one request for every subtask's input watermark. */
export async function getWatermarks(
  http: FlinkHttp,
  conn: string,
  jid: string,
  vid: string,
  parallelism: number,
  timeoutMs = 10_000,
): Promise<SubtaskWatermark[]> {
  const ms = await getJson(
    http,
    conn,
    {
      method: 'GET',
      path: `/jobs/${encodeURIComponent(jid)}/vertices/${encodeURIComponent(vid)}/watermarks`,
      timeoutMs,
    },
    Schema,
    'reading watermarks',
  );
  const byIndex = new Map<number, number | 'ended' | null>();
  for (const m of ms) {
    const i = /^(\d+)\.currentInputWatermark$/.exec(m.id);
    if (!i) continue;
    const n = Number(m.value);
    // Long.MAX_VALUE parses to 2^63 (not exact, but far past any safe integer); Long.MIN_VALUE to -2^63.
    byIndex.set(Number(i[1]), Number.isSafeInteger(n) ? n : n > 0 ? 'ended' : null);
  }
  return Array.from({ length: parallelism }, (_, index) => {
    const v = byIndex.get(index) ?? null;
    return v === 'ended' ? { index, at: null, ended: true } : { index, at: v, ended: false };
  });
}

/** Behind its next-slowest sibling by at least this much: worth a sentence. ponytail: fixed; tune with real jobs. */
const HOLDING_MS = 10_000;

/**
 * Board D09b "Input #0 is 39 s behind the others, so the operator's watermark waits for it": the operator's
 * watermark is the minimum, so the slowest subtask holds it back. Measured against the next-slowest (the board's
 * 41 s vs 2 s). None when any subtask has no watermark (that is its own state, said per row).
 */
export function holdingBack(ws: readonly SubtaskWatermark[]): { index: number; behindMs: number } | null {
  // A subtask whose input ended holds nothing back; one with no watermark yet is its own state (none here).
  const live = ws.filter((w) => !w.ended);
  if (live.length < 2 || live.some((w) => w.at === null)) return null;
  const sorted = [...live].sort((a, b) => a.at! - b.at!);
  const behindMs = sorted[1]!.at! - sorted[0]!.at!;
  return behindMs >= HOLDING_MS ? { index: sorted[0]!.index, behindMs } : null;
}
