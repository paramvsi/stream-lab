import { z } from 'zod';

/**
 * GET /overview — cluster summary: TaskManagers, slots, jobs by state.
 * FLINK: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/rest_api/#overview
 * ponytail: from the documented response; a recorded fixture confirms it later.
 */
export const OverviewSchema = z.looseObject({
  taskmanagers: z.number(),
  'slots-total': z.number(),
  'slots-available': z.number(),
  'jobs-running': z.number(),
  'jobs-finished': z.number(),
  'jobs-cancelled': z.number(),
  'jobs-failed': z.number(),
});
export type FlinkOverview = z.infer<typeof OverviewSchema>;
