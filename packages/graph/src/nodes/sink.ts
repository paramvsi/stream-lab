import { z } from 'zod';
import { defineNode, MAIN_IN } from './shared';

export const sink = defineNode({
  type: 'Sink',
  category: 'Outputs',
  description: 'Write results to a topic or table',
  config: z.object({ name: z.string().min(1), format: z.enum(['table', 'json']), key: z.string() }),
  defaults: () => ({ name: 'alerts', format: 'table' as const, key: '' }),
  inputs: () => [MAIN_IN],
  outputs: () => [],
  summary: (c) => `${c.name} · ${c.format}`,
  outputSchema: () => ({}),
  requires: (c) => (c.key ? [{ port: 'main', field: c.key }] : []),
});
