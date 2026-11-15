import type { NodeSpec, NodeType } from '../types';
import { deadLetter } from './deadletter';
import { deduplicate } from './dedup';
import { filter } from './filter';
import { generator } from './generator';
import { join } from './join';
import { lookup } from './lookup';
import { map } from './map';
import { pattern } from './pattern';
import { route } from './route';
import { sink } from './sink';
import { source } from './source';
import { sql } from './sql';
import { topN } from './topn';
import { union } from './union';
import { validate } from './validate';
import { window } from './window';

// Order = palette order within each category (board B03).
export const NODES = {
  Source: source,
  Generator: generator,
  Filter: filter,
  Map: map,
  Union: union,
  SQL: sql,
  Lookup: lookup,
  Join: join,
  Window: window,
  'Top-N': topN,
  Pattern: pattern,
  Validate: validate,
  Deduplicate: deduplicate,
  'Dead-letter': deadLetter,
  Route: route,
  Sink: sink,
} satisfies Record<NodeType, { type: NodeType }>;

export function spec(type: NodeType): NodeSpec<unknown> {
  return NODES[type] as unknown as NodeSpec<unknown>;
}
export { fieldsIn, PAYMENTS } from './shared';
