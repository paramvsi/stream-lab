import { AppError } from '@sl/errors';
import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp, FlinkResponse } from './http';

/**
 * GET /jobs/:jid/checkpoints — CheckpointingStatistics: counts, the latest of each kind, and recent history.
 * Fields as the Flink 1.20 REST reference lists them (history items read verbatim).
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobs-jobid-checkpoints
 * ponytail: `summary` (min/avg/max per stat) and per-task stats are left out until the checkpoints tab needs them.
 * An IN_PROGRESS checkpoint with no acknowledgement yet has latest_ack_timestamp and end_to_end_duration -1
 * (AbstractCheckpointStats): show "—", not "-1 ms" or 1970.
 */
export const CheckpointSchema = z.looseObject({
  id: z.number(),
  status: z.string(),
  checkpoint_type: z.string().optional(),
  is_savepoint: z.boolean(),
  trigger_timestamp: z.number(),
  latest_ack_timestamp: z.number(),
  end_to_end_duration: z.number(),
  checkpointed_size: z.number().optional(),
  state_size: z.number().optional(),
  num_subtasks: z.number(),
  num_acknowledged_subtasks: z.number(),
});
export const CheckpointStatsSchema = z.looseObject({
  counts: z.looseObject({
    completed: z.number(),
    failed: z.number(),
    in_progress: z.number(),
    restored: z.number(),
    total: z.number(),
  }),
  latest: z
    .looseObject({
      completed: CheckpointSchema.nullable().optional(),
      failed: z
        .looseObject({ id: z.number(), failure_message: z.string().nullable().optional() })
        .nullable()
        .optional(),
    })
    .optional(),
  history: z.array(CheckpointSchema),
});
export type FlinkCheckpoint = z.infer<typeof CheckpointSchema>;
export type FlinkCheckpointStats = z.infer<typeof CheckpointStatsSchema>;

/** Keeps the last response, so a 404's body can tell "checkpointing off" from "job gone". */
function recording(http: FlinkHttp) {
  const last: { r?: FlinkResponse } = {};
  const h: FlinkHttp = async (req) => (last.r = await http(req));
  return { h, last };
}
/**
 * A 404 on /checkpoints or /checkpoints/config: the job has no checkpoint settings at all is JOB-CKPT-NONE; anything else
 * is the job gone (API-404-JOB). Each handler words it its own way: /checkpoints says "Checkpointing has not been
 * enabled.", /checkpoints/config "Checkpointing is not enabled for this job (<jid>)." (1.20 and 2.3 alike).
 * ponytail: /checkpoints/details/:cid (not called yet) says "Checkpointing was not enabled for job <jid>." and, for
 * a checkpoint gone from the stats, "Could not find checkpointing statistics…": add both when it is wired.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/checkpoints/CheckpointingStatisticsHandler.java
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/rest/handler/job/checkpoints/CheckpointConfigHandler.java
 */
function notFound(e: unknown, r: FlinkResponse | undefined, conn: string): unknown {
  if (!(e instanceof AppError) || e.code !== 'API-4XX' || e.params.status !== 404) return e;
  return /checkpointing (has not been|is not) enabled/i.test(r?.body ?? '')
    ? new AppError('JOB-CKPT-NONE', {}, e)
    : new AppError('API-404-JOB', { thing: 'job', conn }, e);
}

/** JOB-04 / JOB-12 (boards D12, D12b): polled every 5 s by the checkpoints view (FLINK_API.md). */
export async function getCheckpoints(
  http: FlinkHttp,
  conn: string,
  jid: string,
  timeoutMs = 10_000,
): Promise<FlinkCheckpointStats> {
  const { h, last } = recording(http);
  try {
    return await getJson(
      h,
      conn,
      { method: 'GET', path: `/jobs/${encodeURIComponent(jid)}/checkpoints`, timeoutMs },
      CheckpointStatsSchema,
      'reading the checkpoints',
    );
  } catch (e) {
    throw notFound(e, last.r, conn);
  }
}

/**
 * Checkpointing off on a streaming job: Flink still answers /checkpoints with zero counts (the same as "none
 * completed yet"); only the config tells them apart: the interval is Long.MAX_VALUE (DISABLED_CHECKPOINT_INTERVAL).
 * JSON gives it to JS as 9223372036854775808 (rounded), so anything from 2^63 − 2^10 counts as off.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-streaming-java/src/main/java/org/apache/flink/streaming/api/graph/StreamingJobGraphGenerator.java
 * (2.x: flink-runtime/src/main/java/org/apache/flink/streaming/api/graph/StreamGraph.java)
 */
const CheckpointConfigSchema = z.looseObject({ interval: z.number() });
export async function checkpointingOff(
  http: FlinkHttp,
  conn: string,
  jid: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const { h, last } = recording(http);
  try {
    const c = await getJson(
      h,
      conn,
      { method: 'GET', path: `/jobs/${encodeURIComponent(jid)}/checkpoints/config`, timeoutMs },
      CheckpointConfigSchema,
      'reading the checkpoint settings',
    );
    return c.interval >= 2 ** 63 - 2 ** 10;
  } catch (e) {
    const m = notFound(e, last.r, conn);
    if (m instanceof AppError && m.code === 'JOB-CKPT-NONE') return true;
    throw m;
  }
}

/** Board D08 "Last checkpoint": the latest completed one, or null when none has completed yet. */
export const lastCompleted = (s: FlinkCheckpointStats): FlinkCheckpoint | null => s.latest?.completed ?? null;
