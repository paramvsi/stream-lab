import { z } from 'zod';
import { defineNode, MAIN_IN, MAIN_OUT, one } from './shared';

export const deduplicate = defineNode({
  type: 'Deduplicate',
  category: 'Quality',
  description: 'Drop repeated events by key',
  config: z.object({
    key: z.array(z.string()).min(1),
    keep: z.enum(['first', 'last']),
    // null = no TTL (DEDUP-NO-TTL warning in M2).
    ttlMs: z.number().int().min(1).nullable(),
  }),
  defaults: () => ({ key: ['payment_id'], keep: 'first' as const, ttlMs: 3600000 }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT],
  summary: (c) => `${c.keep} by ${c.key.join(', ')}`,
  outputSchema: (i) => ({ main: one(i) }),
  requires: (c) => c.key.map((field) => ({ port: 'main', field })),
});
