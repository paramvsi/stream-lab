import { z } from 'zod';
import type { Field, NodeSpec, PortSpec, Schema } from '../types';

export const fieldType = z.enum(['string', 'number', 'boolean', 'timestamp']);
export const field = z.object({ name: z.string().min(1), type: fieldType, required: z.boolean() });
export const ms = z.number().int().min(0);

/** The fintech payments stream every scenario starts from (CLAUDE.md: fintech samples only). */
export const PAYMENTS: Schema = [
  { name: 'payment_id', type: 'string', required: true },
  { name: 'card_id', type: 'string', required: true },
  { name: 'merchant_id', type: 'string', required: true },
  { name: 'amount', type: 'number', required: true },
  { name: 'currency', type: 'string', required: true },
  { name: 'status', type: 'string', required: true },
  { name: 'event_time', type: 'timestamp', required: true },
];

export const MAIN_IN: PortSpec = { id: 'main', label: 'in', kind: 'main' };
export const MAIN_OUT: PortSpec = { id: 'main', label: 'out', kind: 'main' };
export const REJECTED: PortSpec = { id: 'rejected', label: 'rejected', kind: 'side' };
export const LATE: PortSpec = { id: 'late', label: 'late', kind: 'side' };

/** Schema on the (single) edge into `port`, or [] when nothing is connected. */
export const one = (inputs: Record<string, Schema[]>, port = 'main'): Schema => inputs[port]?.[0] ?? [];

const CEL_WORDS = new Set([
  'true',
  'false',
  'null',
  'in',
  'int',
  'uint',
  'double',
  'string',
  'bool',
  'bytes',
  'timestamp',
  'duration',
  'size',
  'has',
  'matches',
  'contains',
  'startsWith',
  'endsWith',
  'exists',
  'all',
  'map',
  'filter',
  'type',
  'dyn',
]);

/**
 * Top-level identifiers an expression reads (so a dropped upstream field shows SIM-SCHEMA-DRIFT).
 * ponytail: regex scan, not a parser. M2 replaces it with cel-js's checked AST (NODE-03).
 */
export function fieldsIn(expr: string): string[] {
  const code = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const out = new Set<string>();
  for (const m of code.matchAll(/(?<![.\w])([A-Za-z_]\w*)\b(?!\s*\()/g)) {
    if (!CEL_WORDS.has(m[1]!)) out.add(m[1]!);
  }
  return [...out];
}

export const pick = (schema: Schema, names: string[]): Schema =>
  names.map((n) => schema.find((f) => f.name === n) ?? { name: n, type: 'string', required: false });

export const without = (schema: Schema, names: string[]): Schema =>
  schema.filter((f) => !names.includes(f.name));

/** Join two schemas; a name clash on the right side becomes `right_<name>`. */
export function merge(left: Schema, right: Schema): Schema {
  const names = new Set(left.map((f) => f.name));
  return [...left, ...right.map((f) => (names.has(f.name) ? { ...f, name: `right_${f.name}` } : f))];
}

export const defineNode = <C>(spec: NodeSpec<C>): NodeSpec<C> => spec;
export type { Field };
