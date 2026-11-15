import { z } from 'zod';
import { defineNode, field, MAIN_OUT, ms, PAYMENTS } from './shared';

export const source = defineNode({
  type: 'Source',
  category: 'Sources',
  description: 'Read events from a topic, a file or the generator',
  config: z.object({
    name: z.string().min(1),
    schema: z.array(field).min(1),
    eventTime: z.string(),
    outOfOrdernessMs: ms,
    idleTimeoutMs: ms,
  }),
  defaults: () => ({
    name: 'payments',
    schema: PAYMENTS,
    eventTime: 'event_time',
    outOfOrdernessMs: 5000,
    idleTimeoutMs: 0,
  }),
  inputs: () => [],
  outputs: () => [MAIN_OUT],
  summary: (c) => c.name,
  outputSchema: (_i, c) => ({ main: c.schema }),
  requires: () => [],
});
