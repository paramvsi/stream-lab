import { z } from 'zod';
import type { FieldType } from '../types';
import { defineNode, LATE, MAIN_IN, MAIN_OUT, ms, one, pick } from './shared';

const KIND = { tumble: 'tumbling', hop: 'sliding', session: 'session', cumulate: 'cumulating' } as const;
const dur = (ms: number) =>
  ms % 3600000 === 0 && ms
    ? `${ms / 3600000} h`
    : ms % 60000 === 0 && ms
      ? `${ms / 60000} min`
      : `${ms / 1000} s`;

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
  // Board B03: "5 min tumbling".
  summary: (c) => `${dur(c.sizeMs)} ${KIND[c.kind]}${c.keyBy.length ? ` by ${c.keyBy.join(', ')}` : ''}`,
  outputSchema: (i, c) => ({
    main: [
      ...pick(one(i), c.keyBy),
      { name: 'window_start', type: 'timestamp', required: true },
      { name: 'window_end', type: 'timestamp', required: true },
      ...c.aggregates.map((a) => ({
        name: a.as,
        // min/max keep the input field's type (a timestamp stays a timestamp); the rest are numbers.
        type:
          (a.fn === 'min' || a.fn === 'max' ? one(i).find((f) => f.name === a.field)?.type : undefined) ??
          ('number' as const),
        required: true,
      })),
    ],
    late: one(i),
  }),
  requires: (c) => [
    ...c.keyBy.map((field) => ({ port: 'main', field })),
    // sum/avg need numbers; min/max also order timestamps (Flink MIN/MAX); count takes anything.
    ...c.aggregates
      .filter((a) => a.field)
      .map((a) => ({
        port: 'main',
        field: a.field,
        ...(a.fn === 'count'
          ? {}
          : {
              type:
                a.fn === 'min' || a.fn === 'max'
                  ? (['number', 'timestamp'] as FieldType[])
                  : ('number' as const),
            }),
      })),
  ],
});
