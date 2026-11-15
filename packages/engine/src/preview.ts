import { Environment } from '@marcbachmann/cel-js';
import {
  configOf,
  propagate,
  spec,
  topoOrder,
  type FieldType,
  type Graph,
  type PipelineNode,
  type Schema,
} from '@sl/graph';

/**
 * Synchronous mini-engine for the drawer's live preview (NODE-04) and "Run to here" (NODE-05).
 * The M2 prompt allows this until the Worker engine (M3). ponytail: windows here are per-event-time buckets
 * over a handful of samples — no watermarks or lateness; the real event-time semantics are M3's.
 */

export type Event = Record<string, string | number | boolean | null>;

/** Deterministic PRNG (SIM-24: same seed, same events). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = Date.parse('2026-11-15T12:00:00Z');
const PICK: Record<string, string[]> = {
  currency: ['AED', 'USD', 'EUR'],
  status: ['approved', 'approved', 'approved', 'declined'],
  card_id: ['c_4471', 'c_2093', 'c_7710'],
  merchant_id: ['m_101', 'm_202', 'm_303'],
};

/** Sample events for a schema: fintech-looking values for known names, typed values otherwise. */
export function sampleEvents(schema: Schema, n: number, seed = 42): Event[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const e: Event = {};
    for (const f of schema) {
      const pool = PICK[f.name];
      e[f.name] = pool ? pool[Math.floor(r() * pool.length)]! : valueOf(f.type, f.name, i, r);
    }
    return e;
  });
}

function valueOf(t: FieldType, name: string, i: number, r: () => number): string | number | boolean {
  switch (t) {
    case 'number':
      return Math.round((5 + r() * 2400) * 100) / 100;
    case 'boolean':
      return r() < 0.5;
    case 'timestamp':
      // ~37 s apart, a little out of order.
      return new Date(BASE + i * 37000 + Math.floor((r() - 0.3) * 20000)).toISOString();
    default:
      return `${name.replace(/_id$/, '')}_${1000 + Math.floor(r() * 9000)}`;
  }
}

const CEL_T = {
  string: 'string',
  number: 'double',
  boolean: 'bool',
  timestamp: 'google.protobuf.Timestamp',
} as const;

function evaluator(schema: Schema) {
  const env = new Environment();
  const seen = new Set<string>();
  for (const f of schema)
    if (f.name && !seen.has(f.name)) {
      seen.add(f.name);
      try {
        env.registerVariable(f.name, f.required ? CEL_T[f.type] : 'dyn');
      } catch {
        // CEL built-in name: not usable in expressions (the checks say so)
      }
    }
  const types = new Map(schema.map((f) => [f.name, f.type]));
  return (expr: string, e: Event): unknown => {
    const ctx: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e))
      ctx[k] = types.get(k) === 'timestamp' && typeof v === 'string' ? new Date(v) : v;
    const out = env.evaluate(expr, ctx);
    return out instanceof Date ? out.toISOString() : typeof out === 'bigint' ? Number(out) : out;
  };
}

export interface NodeRun {
  /** Events per output port. */
  out: Record<string, Event[]>;
  /** Per-key state for stateful nodes (NODE-04 "state per key"). */
  state?: { key: string; value: string }[];
  /** Events whose expression failed (SIM-RUNTIME-EXPR in the real engine). */
  failed: number;
}

const keyOf = (e: Event, keys: string[]) => keys.map((k) => String(e[k] ?? '∅')).join(' · ') || 'all';
const tsOf = (e: Event, field = 'event_time') => Date.parse(String(e[field] ?? '')) || 0;

/** Run one node over sample input events (inputs per port). */
export function runNode(
  n: PipelineNode,
  inputs: Record<string, Event[]>,
  inSchemas: Record<string, Schema>,
): NodeRun {
  const c = configOf(n) as Record<string, unknown> & Record<string, never>;
  const main = inputs['main'] ?? [];
  const evalIn = evaluator(inSchemas['main'] ?? []);
  let failed = 0;
  const test = (expr: string, e: Event) => {
    try {
      return evalIn(expr, e) === true;
    } catch {
      failed++;
      return null;
    }
  };
  if (n.disabled)
    return {
      out: Object.fromEntries(
        spec(n.type)
          .outputs(c)
          .map((p) => [p.id, inputs[Object.keys(inputs)[0] ?? 'main'] ?? []]),
      ),
      failed,
    };

  switch (n.type) {
    case 'Filter': {
      const keep: Event[] = [];
      const rejected: Event[] = [];
      for (const e of main) (test(c.expr as unknown as string, e) ? keep : rejected).push(e);
      return { out: { main: keep, rejected }, failed };
    }
    case 'Map': {
      const assignments = c.assignments as unknown as { field: string; expr: string }[];
      const drop = new Set(c.drop as unknown as string[]);
      const out = main.map((e) => {
        const next: Event = Object.fromEntries(Object.entries(e).filter(([k]) => !drop.has(k)));
        for (const a of assignments) {
          try {
            next[a.field] = evalIn(a.expr, e) as Event[string];
          } catch {
            failed++;
            next[a.field] = null;
          }
        }
        return next;
      });
      return { out: { main: out }, failed };
    }
    case 'Validate': {
      const rules = c.rules as unknown as { name: string; expr: string }[];
      const ok: Event[] = [];
      const rejected: Event[] = [];
      for (const e of main) {
        const bad = rules.find((r) => test(r.expr, e) !== true);
        if (bad) rejected.push({ ...e, reason: bad.name });
        else ok.push(e);
      }
      return { out: { main: ok, rejected }, failed };
    }
    case 'Route': {
      const routes = c.routes as unknown as { id: string; expr: string }[];
      const out: Record<string, Event[]> = Object.fromEntries(
        spec('Route')
          .outputs(c)
          .map((p) => [p.id, []]),
      );
      for (const e of main) {
        const r = routes.find((x) => test(x.expr, e));
        if (r) out[`route-${r.id}`]!.push(e);
        else if (c.defaultBranch) out['default']!.push(e);
      }
      return { out, failed };
    }
    case 'Deduplicate': {
      const keys = c.key as unknown as string[];
      const byKey = new Map<string, { e: Event; n: number }>();
      const order: string[] = [];
      for (const e of main) {
        const k = keyOf(e, keys);
        const hit = byKey.get(k);
        if (!hit) {
          byKey.set(k, { e, n: 1 });
          order.push(k);
        } else byKey.set(k, { e: c.keep === 'last' ? e : hit.e, n: hit.n + 1 });
      }
      return {
        out: { main: order.map((k) => byKey.get(k)!.e) },
        state: order.map((k) => ({ key: k, value: `seen ${byKey.get(k)!.n}×` })),
        failed,
      };
    }
    case 'Window': {
      const size = Math.max(1, c.sizeMs as unknown as number);
      const keyBy = c.keyBy as unknown as string[];
      const aggs = c.aggregates as unknown as { fn: string; field: string; as: string }[];
      const groups = new Map<string, Event[]>();
      for (const e of main) {
        const start = Math.floor(tsOf(e) / size) * size;
        const k = `${start}|${keyOf(e, keyBy)}`;
        groups.set(k, [...(groups.get(k) ?? []), e]);
      }
      const rows: Event[] = [];
      for (const [k, es] of groups) {
        const start = Number(k.split('|')[0]);
        const row: Event = Object.fromEntries(keyBy.map((f) => [f, es[0]![f] ?? null]));
        row.window_start = new Date(start).toISOString();
        row.window_end = new Date(start + size).toISOString();
        for (const a of aggs) {
          const nums = es.map((e) => Number(e[a.field])).filter((x) => !Number.isNaN(x));
          row[a.as] =
            a.fn === 'count'
              ? es.length
              : a.fn === 'sum'
                ? round(nums.reduce((s, x) => s + x, 0))
                : a.fn === 'avg'
                  ? round(nums.reduce((s, x) => s + x, 0) / (nums.length || 1))
                  : a.fn === 'min'
                    ? Math.min(...nums)
                    : Math.max(...nums);
        }
        rows.push(row);
      }
      return {
        out: { main: rows, late: [] },
        state: rows.map((r) => ({
          key: keyOf(r, keyBy),
          value: aggs.map((a) => `${a.as} ${r[a.as]}`).join(', '),
        })),
        failed,
      };
    }
    case 'Top-N': {
      const by = String(c.orderBy);
      const parts = new Map<string, Event[]>();
      for (const e of main) {
        const k = keyOf(e, c.partitionBy as unknown as string[]);
        parts.set(k, [...(parts.get(k) ?? []), e]);
      }
      const out: Event[] = [];
      for (const es of parts.values())
        [...es]
          .sort((a, b) => (Number(b[by]) - Number(a[by])) * (c.desc ? 1 : -1))
          .slice(0, c.n as unknown as number)
          .forEach((e, i) => out.push({ ...e, rank: i + 1 }));
      return { out: { main: out }, failed };
    }
    case 'Union': {
      const all = Object.values(inputs).flat();
      const tag = String(c.tagField ?? '');
      return { out: { main: tag ? all.map((e) => ({ ...e, [tag]: 'input' })) : all }, failed };
    }
    case 'Join': {
      const left = inputs['left'] ?? [];
      const right = inputs['right'] ?? [];
      const lo = (c.lowerMs as unknown as number | null) ?? -Infinity;
      const hi = (c.upperMs as unknown as number | null) ?? Infinity;
      const out: Event[] = [];
      for (const l of left) {
        const matches = right.filter(
          (r) =>
            l[c.leftKey as unknown as string] === r[c.rightKey as unknown as string] &&
            tsOf(r) - tsOf(l) >= lo &&
            tsOf(r) - tsOf(l) <= hi,
        );
        for (const r of matches)
          out.push({
            ...l,
            ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k in l ? `right_${k}` : k, v])),
          });
        if (!matches.length && c.kind === 'left') out.push(l);
      }
      return { out: { main: out }, failed };
    }
    case 'Lookup':
      // No reference tables until M3 (D33): every event is a miss.
      return c.onMiss === 'pass'
        ? { out: { main, rejected: [] }, failed }
        : c.onMiss === 'reject'
          ? { out: { main: [], rejected: main }, failed }
          : { out: { main: [], rejected: [] }, failed };
    default:
      // Sink, Dead-letter (what reaches them), Pattern/SQL (v1): pass through.
      return { out: { main }, failed };
  }
}

const round = (x: number) => Math.round(x * 100) / 100;

export interface Preview {
  /** Input events per port (up to `n` each). */
  input: Record<string, Event[]>;
  run: NodeRun;
}

/**
 * NODE-04 / NODE-05: run the pipeline from its sources up to `nodeId` on `n` sample events per source, and
 * return what reaches the node and what it emits.
 */
export function runToHere(g: Graph, nodeId: string, n = 5, seed = 42): Preview | null {
  const target = g.nodes.find((x) => x.id === nodeId);
  if (!target) return null;
  // Only the node's ancestors matter.
  const need = new Set([nodeId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of g.edges)
      if (need.has(e.target) && !need.has(e.source)) {
        need.add(e.source);
        grew = true;
      }
  }
  const s = propagate(g);
  const emitted = new Map<string, Record<string, Event[]>>();
  let i = 0;
  for (const node of topoOrder(g)) {
    if (!need.has(node.id)) continue;
    const inputs: Record<string, Event[]> = {};
    for (const e of g.edges)
      if (e.target === node.id)
        (inputs[e.targetHandle] ??= []).push(...(emitted.get(e.source)?.[e.sourceHandle] ?? []));
    const isSource = spec(node.type).category === 'Sources';
    const inSchemas = Object.fromEntries(
      Object.entries(s.in.get(node.id) ?? {}).map(([p, l]) => [p, l[0] ?? []]),
    );
    const run = isSource
      ? {
          out: { main: node.disabled ? [] : sampleEvents(s.out.get(node.id)?.['main'] ?? [], n, seed + i++) },
          failed: 0,
        }
      : runNode(node, inputs, inSchemas);
    emitted.set(node.id, run.out);
    if (node.id === nodeId) return { input: inputs, run };
  }
  return null;
}
