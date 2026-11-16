import { z } from 'zod';
import { defineNode, MAIN_IN, MAIN_OUT } from './shared';

export const union = defineNode({
  type: 'Union',
  category: 'Transform',
  description: 'Merge two or more streams into one',
  config: z.object({ tagField: z.string() }),
  defaults: () => ({ tagField: '' }),
  inputs: () => [{ ...MAIN_IN, multi: true }],
  outputs: () => [MAIN_OUT],
  summary: (c) => (c.tagField ? `tag → ${c.tagField}` : 'merge'),
  // Mismatched inputs are SIM-UNION-SCHEMA (graph validation); the first input wins here.
  outputSchema: (i, c) => {
    const first = i['main']?.[0] ?? [];
    // A tag named like an existing field replaces it (one column of that name).
    return {
      main: c.tagField
        ? [
            ...first.filter((f) => f.name !== c.tagField),
            { name: c.tagField, type: 'string', required: true },
          ]
        : first,
    };
  },
  requires: () => [],
});
