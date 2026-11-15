import { z } from 'zod';
import { defineNode, fieldsIn, MAIN_IN, MAIN_OUT, one, REJECTED } from './shared';

export const filter = defineNode({
  type: 'Filter',
  category: 'Transform',
  description: 'Keep events that match a rule',
  config: z.object({ expr: z.string() }),
  defaults: () => ({ expr: 'amount > 0' }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT, REJECTED],
  summary: (c) => c.expr,
  outputSchema: (i) => ({ main: one(i), rejected: one(i) }),
  requires: (c) => fieldsIn(c.expr).map((field) => ({ port: 'main', field })),
});
