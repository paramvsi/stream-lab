import { z } from 'zod';
import { defineNode, MAIN_IN, ms } from './shared';

export const deadLetter = defineNode({
  type: 'Dead-letter',
  category: 'Quality',
  description: 'Collect rejected and late events',
  config: z.object({ reasonField: z.string().min(1), retentionMs: ms }),
  defaults: () => ({ reasonField: 'reason', retentionMs: 86400000 }),
  inputs: () => [{ ...MAIN_IN, multi: true }],
  outputs: () => [],
  summary: (c) => `keeps ${c.retentionMs / 3600000} h`,
  outputSchema: () => ({}),
  requires: () => [],
});
