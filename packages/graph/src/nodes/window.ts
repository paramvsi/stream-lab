import { z } from 'zod';
import { defineNode, LATE, MAIN_IN, MAIN_OUT, ms, one, pick } from './shared';

const aggregate = z.object({
  fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  field: z.string(),
  as: z.string().min(1),
});

export const window = defineNode({
  type: 'Window',
  category: 'Time & state',
  description: 'Group events into time windows and aggregate',
  config: z.object({
    kind: z.enum(['tumble', 'hop', 'session', 'cumulate']),
    sizeMs: ms,
    slideMs: ms,
    gapMs: ms,
    keyBy: z.array(z.string()),
    aggregates: z.array(aggregate),
    allowedLatenessMs: ms,
  }),
  defaults: () => ({
    kind: 'tumble' as const,
    sizeMs: 60000,
    slideMs: 10000,
    gapMs: 30000,
    keyBy: ['card_id'],
    aggregates: [{ fn: 'count' as const, field: '', as: 'payments' }],
    allowedLatenessMs: 0,
  }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT, LATE],
  summary: (c) => `${c.kind} ${c.sizeMs / 1000}s by ${c.keyBy.join(', ') || '—'}`,
  outputSchema: (i, c) => ({
    main: [
      ...pick(one(i), c.keyBy),
      { name: 'window_start', type: 'timestamp', required: true },
      { name: 'window_end', type: 'timestamp', required: true },
      ...c.aggregates.map((a) => ({ name: a.as, type: 'number' as const, required: true })),
    ],
    late: one(i),
  }),
  requires: (c) => [
    ...c.keyBy.map((field) => ({ port: 'main', field })),
    // sum/avg/min/max need a number; count may name any field (or none).
    ...c.aggregates
      .filter((a) => a.field)
      .map((a) => ({
        port: 'main',
        field: a.field,
        ...(a.fn === 'count' ? {} : { type: 'number' as const }),
      })),
  ],
});
