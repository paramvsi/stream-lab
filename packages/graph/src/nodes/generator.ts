import { z } from 'zod';
import { defineNode, MAIN_OUT, PAYMENTS } from './shared';

const pct = z.number().min(0).max(100);

export const generator = defineNode({
  type: 'Generator',
  category: 'Sources',
  description: 'Seeded synthetic events with chaos controls',
  config: z.object({
    rate: z.number().int().min(1).max(10000),
    count: z.number().int().min(1).max(1_000_000),
    keys: z.number().int().min(1),
    latePct: pct,
    outOfOrderPct: pct,
    duplicatePct: pct,
    badRowsPct: pct,
    seed: z.number().int().min(0).max(4_294_967_295),
  }),
  defaults: () => ({
    rate: 50,
    count: 1000,
    keys: 20,
    latePct: 5,
    outOfOrderPct: 10,
    duplicatePct: 2,
    badRowsPct: 1,
    seed: 42,
  }),
  inputs: () => [],
  outputs: () => [MAIN_OUT],
  summary: (c) => `${c.rate}/s · seed ${c.seed}`,
  outputSchema: () => ({ main: PAYMENTS }),
  requires: () => [],
});
