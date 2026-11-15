import { z } from 'zod';
import { defineNode, fieldsIn, MAIN_IN, MAIN_OUT, one, REJECTED } from './shared';

export const validate = defineNode({
  type: 'Validate',
  category: 'Quality',
  description: 'Check rules; send failures aside',
  config: z.object({
    rules: z.array(
      z.object({ name: z.string().min(1), expr: z.string(), severity: z.enum(['error', 'warning']) }),
    ),
  }),
  defaults: () => ({ rules: [{ name: 'positive amount', expr: 'amount > 0', severity: 'error' as const }] }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT, REJECTED],
  summary: (c) => `${c.rules.length} rule${c.rules.length === 1 ? '' : 's'}`,
  outputSchema: (i) => ({ main: one(i), rejected: one(i) }),
  requires: (c) => c.rules.flatMap((r) => fieldsIn(r.expr)).map((field) => ({ port: 'main', field })),
});
