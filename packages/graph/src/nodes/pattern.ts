import { z } from 'zod';
import { defineNode, MAIN_IN, MAIN_OUT, ms, one } from './shared';

// v1 (TRACEABILITY B-03): registered so imports validate; hidden from the Phase 1 palette.
export const pattern = defineNode({
  type: 'Pattern',
  category: 'Time & state',
  description: 'Detect a sequence of events (v1)',
  v1: true,
  config: z.object({
    steps: z.array(
      z.object({
        name: z.string().min(1),
        condition: z.string(),
        min: z.number().int().min(0),
        max: z.number().int().min(1),
      }),
    ),
    withinMs: ms,
    contiguity: z.enum(['strict', 'relaxed']),
  }),
  defaults: () => ({ steps: [], withinMs: 600000, contiguity: 'relaxed' as const }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT],
  summary: (c) => `${c.steps.length} steps within ${c.withinMs / 1000}s`,
  outputSchema: (i) => ({ main: one(i) }),
  requires: () => [],
});
