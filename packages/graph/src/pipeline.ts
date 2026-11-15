import { z } from 'zod';
import { topoOrder } from './graph';
import { NODES, spec } from './nodes';
import type { Field, FieldType, Issue, NodeType, PipelineEdge, PipelineNode, Schema } from './types';

export const CURRENT_VERSION = 1;

const nodeType = z.enum(Object.keys(NODES) as [NodeType, ...NodeType[]]);

export const PipelineV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string(),
  updatedAt: z.string(),
  seed: z.number().int(),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: nodeType,
      position: z.object({ x: z.number(), y: z.number() }),
      config: z.unknown(),
      disabled: z.boolean().optional(),
      label: z.string().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1),
      source: z.string(),
      sourceHandle: z.string(),
      target: z.string(),
      targetHandle: z.string(),
    }),
  ),
  data: z.object({ generator: z.unknown().optional(), refTables: z.array(z.string()) }),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});
export type Pipeline = z.infer<typeof PipelineV1> & { nodes: PipelineNode[]; edges: PipelineEdge[] };

/** Pure `vN → vN+1` steps, keyed by the version they upgrade FROM (ARCHITECTURE.md § Pipeline JSON). */
export type Migration = (p: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Record<number, Migration> = {};

export function migrate(
  raw: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = CURRENT_VERSION,
): Record<string, unknown> {
  let p = raw;
  for (let v = Number(p.schemaVersion); v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from schemaVersion ${v}`);
    p = { ...step(p), schemaVersion: v + 1 };
  }
  return p;
}

export function newPipeline(id: string, name: string, now = new Date()): Pipeline {
  return {
    schemaVersion: 1,
    id,
    name,
    updatedAt: now.toISOString(),
    seed: 42,
    nodes: [],
    edges: [],
    data: { refTables: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

type Parsed = { ok: true; pipeline: Pipeline } | { ok: false; issue: Issue };
const fail = (file: string, reason: string): Parsed => ({
  ok: false,
  issue: { code: 'IMPORT-INVALID', params: { file, reason } },
});

/**
 * Import/share-link entry point. Every failure is IMPORT-INVALID with a plain reason.
 * Config is checked for shape only: a half-filled field (NODE-REQUIRED) is fixed in the drawer, not refused here.
 */
export function parsePipeline(input: unknown, file: string): Parsed {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fail(file, 'it is not valid JSON');
    }
  }
  if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || typeof raw.schemaVersion !== 'number')
    return fail(file, 'it is not a Stream Lab pipeline');
  if (raw.schemaVersion > CURRENT_VERSION) return fail(file, 'it was made with a newer Stream Lab');

  let migrated: Record<string, unknown>;
  try {
    migrated = migrate(raw as Record<string, unknown>);
  } catch {
    return fail(file, `version ${raw.schemaVersion} can not be upgraded`);
  }
  const r = PipelineV1.safeParse(migrated);
  if (!r.success) {
    const i = r.error.issues[0]!;
    return fail(file, `${i.path.join('.') || 'the file'} is invalid (${i.message})`);
  }
  const p = r.data as Pipeline;

  const ids = new Set<string>();
  for (const n of p.nodes) {
    if (ids.has(n.id)) return fail(file, `node id "${n.id}" is used twice`);
    ids.add(n.id);
    const shape = spec(n.type).config.safeParse({
      ...(spec(n.type).defaults() as object),
      ...(n.config as object),
    });
    const hard = shape.success ? [] : shape.error.issues.filter((i) => i.code !== 'too_small');
    if (hard.length) return fail(file, `node "${n.id}" has a bad setting (${hard[0]!.path.join('.')})`);
  }
  for (const e of p.edges) {
    const src = p.nodes.find((n) => n.id === e.source);
    const tgt = p.nodes.find((n) => n.id === e.target);
    if (!src || !tgt) return fail(file, `edge "${e.id}" points to a missing node`);
  }
  if (topoOrder(p).length !== p.nodes.length) return fail(file, 'it contains a loop');
  return { ok: true, pipeline: p };
}

/* ---------- SIM-25: schema inferred from sample data, shown as JSON Schema ---------- */

const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function typeOf(v: unknown): FieldType | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v))) return 'timestamp';
  return 'string';
}

/** Infer fields from sample rows: a field is required if every row has a value; mixed types widen to string. */
export function inferSchema(rows: Record<string, unknown>[]): Schema {
  const order: string[] = [];
  const types = new Map<string, FieldType | null>();
  const seen = new Map<string, number>();
  for (const row of rows)
    for (const [k, v] of Object.entries(row)) {
      if (!types.has(k)) {
        order.push(k);
        types.set(k, null);
      }
      const t = typeOf(v);
      if (t === null) continue;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      const prev = types.get(k);
      types.set(k, prev === null || prev === t ? t : 'string');
    }
  return order.map((name): Field => ({
    name,
    type: types.get(name) ?? 'string',
    required: rows.length > 0 && seen.get(name) === rows.length,
  }));
}

export function toJsonSchema(schema: Schema) {
  const prop = (t: FieldType) =>
    t === 'timestamp' ? { type: 'string', format: 'date-time' } : { type: t === 'number' ? 'number' : t };
  return {
    type: 'object',
    properties: Object.fromEntries(schema.map((f) => [f.name, prop(f.type)])),
    required: schema.filter((f) => f.required).map((f) => f.name),
  };
}
