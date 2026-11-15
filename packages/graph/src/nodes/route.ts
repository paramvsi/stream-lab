import { z } from 'zod';
import { defineNode, fieldsIn, MAIN_IN, one } from './shared';

export const route = defineNode({
  type: 'Route',
  category: 'Outputs',
  description: 'Send events to different outputs',
  config: z.object({
    // `id` keeps each rule's output handle stable when rules are removed or reordered.
    routes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), expr: z.string() })).min(1),
    defaultBranch: z.boolean(),
  }),
  defaults: () => ({
    routes: [{ id: 'r1', name: 'high value', expr: 'amount > 1000' }],
    defaultBranch: true,
  }),
  inputs: () => [MAIN_IN],
  outputs: (c) => [
    ...c.routes.map((r) => ({ id: `route-${r.id}`, label: r.name, kind: 'main' as const })),
    ...(c.defaultBranch ? [{ id: 'default', label: 'default', kind: 'main' as const }] : []),
  ],
  summary: (c) =>
    `${c.routes.length} route${c.routes.length === 1 ? '' : 's'}${c.defaultBranch ? ' + default' : ''}`,
  outputSchema: (i, c) =>
    Object.fromEntries([
      ...c.routes.map((r) => [`route-${r.id}`, one(i)]),
      ...(c.defaultBranch ? [['default', one(i)]] : []),
    ]),
  requires: (c) => c.routes.flatMap((r) => fieldsIn(r.expr)).map((field) => ({ port: 'main', field })),
});
