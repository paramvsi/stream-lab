import { z } from 'zod';
import { defineNode, fieldsIn, fieldType, MAIN_IN, MAIN_OUT, one, without } from './shared';

export const map = defineNode({
  type: 'Map',
  category: 'Transform',
  description: 'Add, rename or compute fields',
  config: z.object({
    // ponytail: `type` is declared, not inferred; cel-js type-checking replaces it in M2 (NODE-03).
    assignments: z.array(z.object({ field: z.string().min(1), expr: z.string(), type: fieldType })),
    drop: z.array(z.string()),
  }),
  defaults: () => ({ assignments: [], drop: [] }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT],
  summary: (c) =>
    c.assignments.length ? c.assignments.map((a) => `${a.field} = ${a.expr}`).join(', ') : 'no changes',
  outputSchema: (i, c) => {
    const names = c.assignments.map((a) => a.field);
    const kept = without(without(one(i), c.drop), names);
    return {
      main: [...kept, ...c.assignments.map((a) => ({ name: a.field, type: a.type, required: true }))],
    };
  },
  requires: (c) =>
    [...c.drop, ...c.assignments.flatMap((a) => fieldsIn(a.expr))].map((field) => ({ port: 'main', field })),
});
