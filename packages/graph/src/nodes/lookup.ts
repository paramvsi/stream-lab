import { z } from 'zod';
import { defineNode, MAIN_IN, MAIN_OUT, merge, one, REJECTED, without } from './shared';

export const lookup = defineNode({
  type: 'Lookup',
  category: 'Enrich',
  description: 'Join each event with a reference table',
  config: z.object({
    table: z.string(),
    key: z.string(),
    tableKey: z.string(),
    asOf: z.boolean(),
    onMiss: z.enum(['drop', 'pass', 'reject']),
  }),
  defaults: () => ({
    table: 'merchants',
    key: 'merchant_id',
    tableKey: 'merchant_id',
    asOf: true,
    onMiss: 'pass' as const,
  }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT, REJECTED],
  summary: (c) => (c.table ? `${c.table} on ${c.key}` : 'no table'),
  outputSchema: (i, c, ctx) => {
    const table = without(ctx.refTables[c.table] ?? [], [c.tableKey]);
    // A miss passes the event through without the table's fields, so they are optional.
    return {
      main: merge(
        one(i),
        table.map((f) => ({ ...f, required: false })),
      ),
      rejected: one(i),
    };
  },
  requires: (c) => (c.key ? [{ port: 'main', field: c.key }] : []),
});
