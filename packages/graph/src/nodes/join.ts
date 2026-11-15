import { z } from 'zod';
import { defineNode, MAIN_OUT, merge, one } from './shared';

export const join = defineNode({
  type: 'Join',
  category: 'Enrich',
  description: 'Combine two streams on a key',
  config: z.object({
    kind: z.enum(['inner', 'left']),
    leftKey: z.string(),
    rightKey: z.string(),
    // null = unbounded (JOIN-NO-BOUND warning in M2).
    lowerMs: z.number().int().nullable(),
    upperMs: z.number().int().nullable(),
  }),
  defaults: () => ({
    kind: 'inner' as const,
    leftKey: 'card_id',
    rightKey: 'card_id',
    lowerMs: -600000,
    upperMs: 0,
  }),
  inputs: () => [
    { id: 'left', label: 'left', kind: 'main' as const },
    { id: 'right', label: 'right', kind: 'main' as const },
  ],
  outputs: () => [MAIN_OUT],
  summary: (c) => `${c.kind} ${c.leftKey} = ${c.rightKey}`,
  outputSchema: (i, c) => {
    const right = one(i, 'right').map((f) => (c.kind === 'left' ? { ...f, required: false } : f));
    return { main: merge(one(i, 'left'), right) };
  },
  requires: (c) => [
    ...(c.leftKey ? [{ port: 'left', field: c.leftKey }] : []),
    ...(c.rightKey ? [{ port: 'right', field: c.rightKey }] : []),
  ],
});
