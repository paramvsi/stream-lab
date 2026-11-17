import { z } from 'zod';

/**
 * Job states as Flink documents them (the same enum on /jobs/overview, /jobs and /jobs/:jid).
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobs-overview
 */
export const JOB_STATES = [
  'INITIALIZING',
  'CREATED',
  'RUNNING',
  'FAILING',
  'FAILED',
  'CANCELLING',
  'CANCELED',
  'FINISHED',
  'RESTARTING',
  'SUSPENDED',
  'RECONCILING',
] as const;
export type JobState = (typeof JOB_STATES)[number];

/**
 * GET /jobs/overview — one row per job. `jid` is typed "any" in the docs: read as a string. `tasks` counts tasks per
 * state; its keys are not documented, so it is kept as a string → number map. A state outside the enum (a newer
 * Flink) is kept as text, not rejected.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobs-overview
 */
export const JobRowSchema = z.looseObject({
  jid: z.coerce.string(),
  name: z.string(),
  state: z.string(),
  'start-time': z.number(),
  'end-time': z.number(),
  duration: z.number(),
  'last-modification': z.number(),
  tasks: z.record(z.string(), z.number()).optional(),
});
export const JobsListSchema = z.looseObject({ jobs: z.array(JobRowSchema) });
export type FlinkJobRow = z.infer<typeof JobRowSchema>;

/**
 * GET /taskmanagers — TaskManagerInfo per worker.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#taskmanagers
 */
const ResourceSchema = z.looseObject({
  cpuCores: z.number(),
  taskHeapMemory: z.number(),
  taskOffHeapMemory: z.number(),
  managedMemory: z.number(),
  networkMemory: z.number(),
});
export const TaskManagerSchema = z.looseObject({
  id: z.coerce.string(),
  path: z.string(),
  dataPort: z.number(),
  timeSinceLastHeartbeat: z.number(),
  slotsNumber: z.number(),
  freeSlots: z.number(),
  blocked: z.boolean().optional(),
  totalResource: ResourceSchema.optional(),
  freeResource: ResourceSchema.optional(),
  hardware: z
    .looseObject({
      cpuCores: z.number(),
      physicalMemory: z.number(),
      freeMemory: z.number(),
      managedMemory: z.number(),
    })
    .optional(),
});
export const TaskManagersSchema = z.looseObject({ taskmanagers: z.array(TaskManagerSchema) });
export type FlinkTaskManager = z.infer<typeof TaskManagerSchema>;

/**
 * GET /jobmanager/config — the cluster configuration: a top-level array of {key, value}.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobmanager-config
 */
export const JobManagerConfigSchema = z.array(z.looseObject({ key: z.string(), value: z.string() }));

/**
 * GET /jobs/:jid — JobDetailsInfo: the job, its vertices (operators chained into tasks) with I/O metrics, and the
 * plan (raw JSON: its shape is not documented, so it is kept as is).
 * FLINK: https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/ops/rest_api/#jobs-jobid
 */
export const VertexSchema = z.looseObject({
  id: z.coerce.string(),
  name: z.string(),
  parallelism: z.number(),
  maxParallelism: z.number().optional(),
  'start-time': z.number(),
  'end-time': z.number(),
  duration: z.number(),
  status: z.string(),
  tasks: z.record(z.string(), z.number()).optional(),
  metrics: z
    .looseObject({
      'read-records': z.number(),
      'write-records': z.number(),
      'read-bytes': z.number(),
      'write-bytes': z.number(),
      'accumulated-backpressured-time': z.number().optional(),
      'accumulated-idle-time': z.number().optional(),
      'accumulated-busy-time': z.number().optional(),
    })
    .optional(),
});
export const JobDetailSchema = z.looseObject({
  jid: z.coerce.string(),
  name: z.string(),
  isStoppable: z.boolean().optional(),
  state: z.string(),
  'job-type': z.string().optional(),
  'start-time': z.number(),
  'end-time': z.number(),
  duration: z.number(),
  now: z.number().optional(),
  timestamps: z.record(z.string(), z.number()).optional(),
  vertices: z.array(VertexSchema),
  'status-counts': z.record(z.string(), z.number()).optional(),
  plan: z.unknown().optional(),
});
export type FlinkJobDetail = z.infer<typeof JobDetailSchema>;
export type FlinkVertex = z.infer<typeof VertexSchema>;
