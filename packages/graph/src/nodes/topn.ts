import { z } from 'zod';
import { defineNode, MAIN_IN, MAIN_OUT, one } from './shared';

export const topN = defineNode({
  type: 'Top-N',
  category: 'Time & state',
  description: 'Keep the N largest per group',
  config: z.object({
    partitionBy: z.array(z.string()),
    orderBy: z.string(),
    desc: z.boolean(),
    n: z.number().int().min(1),
    withinWindow: z.boolean(),
  }),
  defaults: () => ({ partitionBy: ['merchant_id'], orderBy: 'amount', desc: true, n: 3, withinWindow: true }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT],
  summary: (c) => `top ${c.n} by ${c.orderBy}`,
  outputSchema: (i) => ({ main: [...one(i), { name: 'rank', type: 'number', required: true }] }),
  requires: (c) =>
    [...c.partitionBy, ...(c.orderBy ? [c.orderBy] : [])].map((field) => ({ port: 'main', field })),
});
