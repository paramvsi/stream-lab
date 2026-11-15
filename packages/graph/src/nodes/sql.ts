import { z } from 'zod';
import { defineNode, MAIN_IN, MAIN_OUT, one } from './shared';

// v1 (NODE-08, DuckDB-WASM): registered so imports validate; hidden from the Phase 1 palette.
// Category follows NODES.md (Transform); seed/node-icons.json says Outputs — MORNING.md D3.
export const sql = defineNode({
  type: 'SQL',
  category: 'Transform',
  description: 'Free SQL over the stream (v1)',
  v1: true,
  config: z.object({ query: z.string() }),
  defaults: () => ({ query: 'SELECT * FROM input' }),
  inputs: () => [MAIN_IN],
  outputs: () => [MAIN_OUT],
  summary: (c) => c.query.split('\n')[0] ?? '',
  // ponytail: passthrough until DuckDB describes the query result (v1).
  outputSchema: (i) => ({ main: one(i) }),
  requires: () => [],
});
