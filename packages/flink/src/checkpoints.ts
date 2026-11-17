import { z } from 'zod';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid/checkpoints — CheckpointingStatistics: counts, the latest of each kind, and recent history.
 * Fields as the Flink 1.20 REST reference lists them (history items read verbatim).
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobs-jobid-checkpoints
 * ponytail: `summary` (min/avg/max per stat) and per-task stats are left out until the checkpoints tab needs them.
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

/** JOB-04 (boards D12, D12b): polled every 5 s by the checkpoints view (FLINK_API.md). */
export async function getCheckpoints(
  http: FlinkHttp,
  conn: string,
  jid: string,
  timeoutMs = 10_000,
): Promise<FlinkCheckpointStats> {
  return getJson(
    http,
    conn,
    { method: 'GET', path: `/jobs/${encodeURIComponent(jid)}/checkpoints`, timeoutMs },
    CheckpointStatsSchema,
    'reading the checkpoints',
  );
}

/** Board D08 "Last checkpoint": the latest completed one, or null when none has completed yet. */
export const lastCompleted = (s: FlinkCheckpointStats): FlinkCheckpoint | null => s.latest?.completed ?? null;
