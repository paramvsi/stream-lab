import { Environment } from '@marcbachmann/cel-js';
import {
  configOf,
  labelOf,
  propagate,
  spec,
  topoOrder,
  type Graph,
  type PipelineNode,
  type Schema,
} from '@sl/graph';
import { subtaskOf } from './keygroups';
import { rng, type Event } from './preview';

/**
 * The run engine (M3): event-time simulation with Flink semantics (ARCHITECTURE.md "Engine semantics").
 * Pure and synchronous; the Worker (worker.ts) drives it and batches stats. Deterministic: seeded generator,
 * arrivals ordered by (arrival time, source, sequence).
 */

type Cfg = Record<string, unknown>;
const cfg = (n: PipelineNode) => configOf(n) as Cfg;

export interface SimEvent {
  /** Event time (epoch ms). */
  ts: number;
  data: Event;
  /** Why it went to a side output / dead letter. */
  reason?: string;
}

export interface RefTable {
  columns: Schema;
  rows: Event[];
  /** Versioned: rows carry `valid_from` (ISO); as-of lookups pick the latest version ≤ event time. */
  versioned?: boolean;
}

export interface RunOptions {
  /** Pipeline-level seed for sources that are not Generators. */
  seed?: number;
  /** Simulated subtasks per keyed operator (ENG-03). */
  parallelism?: number;
  refTables?: Record<string, RefTable>;
  /** Uploaded rows per Source node id (DATA-02); otherwise sources generate. */
  sourceData?: Record<string, Event[]>;
  /** Arrival spacing per uploaded source (ms of simulation clock); default 20. */
  sourceGapMs?: Record<string, number>;
  /** Cap on rows kept per sink / dead-letter for the Output tab. */
  keep?: number;
}

export interface NodeStats {
  in: number;
  out: Record<string, number>;
  failed: number;
  late: number;
  /** Current input watermark (epoch ms); -Infinity before the first. */
  watermark: number;
  /** Events per simulated subtask (keyed operators). */
  subtasks?: number[];
  /** Keys held in state. */
  keys?: number;
}

export interface TimelineEntry {
  kind: 'fire' | 'late' | 'fail' | 'watermark';
  node: string;
  /** Simulation clock (ms since start). */
  at: number;
  ts: number;
  watermark: number;
  reason?: string;
}

export interface RunStats {
  processed: number;
  total: number;
  /** Simulation clock: ms since the first arrival. */
  now: number;
  nodes: Record<string, NodeStats>;
  edges: Record<string, number>;
  outputs: Record<string, Event[]>;
  deadLetter: { node: string; reason: string; data: Event }[];
  timeline: TimelineEntry[];
  done: boolean;
}

/* ---------------- generator (DATA-01, seeded chaos) ---------------- */

export const BASE_TIME = Date.parse('2026-11-15T12:00:00Z');
// FLINK: generated sources use bounded out-of-orderness; the Generator node has no setting, 5 s like Source.
export const GENERATOR_OOO_MS = 5000;

interface Arrival {
  at: number;
  src: number;
  seq: number;
  ev: SimEvent;
}

const POOLS: Record<string, string[]> = {
  currency: ['AED', 'USD', 'EUR'],
  status: ['approved', 'approved', 'approved', 'declined'],
};

/** Seeded payments with chaos: out-of-order, late, duplicate and bad rows (Generator settings). */
export function generate(
  schema: Schema,
  c: {
    rate: number;
    count: number;
    keys: number;
    latePct: number;
    outOfOrderPct: number;
    duplicatePct: number;
    badRowsPct: number;
    seed: number;
  },
  timeField = 'event_time',
  oooMs = GENERATOR_OOO_MS,
): { at: number; ev: SimEvent }[] {
  const r = rng(c.seed);
  const gap = 1000 / Math.max(1, c.rate);
  const out: { at: number; ev: SimEvent }[] = [];
  for (let i = 0; i < c.count; i++) {
    const at = i * gap;
    let ts = BASE_TIME + Math.round(at);
    const roll = r() * 100;
    if (roll < c.latePct) ts -= oooMs + 1000 + Math.floor(r() * 60000);
    else if (roll < c.latePct + c.outOfOrderPct) ts -= Math.floor(r() * oooMs);
    const data: Event = {};
    for (const f of schema) {
      const pool = POOLS[f.name];
      data[f.name] =
        f.name === timeField
          ? new Date(ts).toISOString()
          : f.name === 'payment_id'
            ? `p_${100000 + i}`
            : f.name === 'card_id'
              ? `c_${1000 + Math.floor(r() * c.keys)}`
              : f.name === 'merchant_id'
                ? `m_${100 + Math.floor(r() * 12)}`
                : pool
                  ? pool[Math.floor(r() * pool.length)]!
                  : f.type === 'number'
                    ? Math.round((5 + r() * 2400) * 100) / 100
                    : f.type === 'boolean'
                      ? r() < 0.5
                      : f.type === 'timestamp'
                        ? new Date(ts).toISOString()
                        : `${f.name}_${1000 + Math.floor(r() * 9000)}`;
    }
    // A bad row: a required number is missing (expressions fail → SIM-RUNTIME-EXPR → dead letter).
    if (r() * 100 < c.badRowsPct) {
      const num = schema.find((f) => f.type === 'number');
      if (num) data[num.name] = null;
    }
    out.push({ at, ev: { ts, data } });
    if (r() * 100 < c.duplicatePct) out.push({ at: at + gap / 2, ev: { ts, data: { ...data } } });
  }
  return out;
}

const GEN_DEFAULTS = {
  rate: 50,
  count: 1000,
  keys: 20,
  latePct: 5,
  outOfOrderPct: 10,
  duplicatePct: 2,
  badRowsPct: 1,
};

/* ---------------- CEL ---------------- */

const CEL_T = {
  string: 'string',
  number: 'double',
  boolean: 'bool',
  timestamp: 'google.protobuf.Timestamp',
} as const;

function compiler(schema: Schema) {
  const env = new Environment();
  const names: string[] = [];
  for (const f of schema)
    if (f.name && !names.includes(f.name))
      try {
        env.registerVariable(f.name, f.required ? CEL_T[f.type] : 'dyn');
        names.push(f.name);
      } catch {
        // a CEL built-in name: not usable in expressions (validation says so)
      }
  const types = new Map(schema.map((f) => [f.name, f.type]));
  const cache = new Map<string, ((ctx: Record<string, unknown>) => unknown) | Error>();
  return (expr: string, e: Event): unknown => {
    let fn = cache.get(expr);
    if (!fn) {
      try {
        fn = env.parse(expr) as unknown as (ctx: Record<string, unknown>) => unknown;
      } catch (err) {
        fn = err as Error;
      }
      cache.set(expr, fn);
    }
    if (fn instanceof Error) throw fn;
    const ctx: Record<string, unknown> = {};
    for (const k of names) {
      const v = e[k] ?? null;
      ctx[k] = types.get(k) === 'timestamp' && typeof v === 'string' ? new Date(v) : v;
    }
    const out = fn(ctx);
    return out instanceof Date ? out.toISOString() : typeof out === 'bigint' ? Number(out) : out;
  };
}

/* ---------------- operators ---------------- */

interface Ctx {
  emit: (port: string, ev: SimEvent) => void;
  fail: (ev: SimEvent, reason: string) => void;
  late: (ev: SimEvent) => void;
  fire: (ts: number) => void;
  now: () => number;
  keyed: (key: string) => void;
}

interface Operator {
  process(port: string, ev: SimEvent, from: string): void;
  /** Called when the input watermark advances (before it is forwarded downstream). */
  advance?(wm: number): void;
  keys?(): number;
}

const keyOf = (e: Event, keys: string[]) => keys.map((k) => String(e[k] ?? '∅')).join('|');
const iso = (ms: number) => new Date(ms).toISOString();
const round = (x: number) => Math.round(x * 100) / 100;

interface Agg {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field: string;
  as: string;
}
type Acc = { n: number; sum: number; min: Event[string]; max: Event[string] };
const rank = (v: Event[string]) => {
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? String(v ?? '') : t;
};

function windowsFor(c: Cfg, ts: number): [number, number][] {
  const size = Math.max(1, Number(c.sizeMs));
  const slide = Math.max(1, Number(c.slideMs));
  switch (c.kind) {
    case 'hop': {
      // FLINK: SlidingEventTimeWindows.assignWindows — starts at multiples of slide covering ts.
      const out: [number, number][] = [];
      for (let s = ts - (((ts % slide) + slide) % slide); s > ts - size; s -= slide) out.push([s, s + size]);
      return out;
    }
    case 'cumulate': {
      // FLINK: CUMULATE(step = slide, max size = size): [start, start + k·step) for every k with end > ts.
      const start = ts - (((ts % size) + size) % size);
      const out: [number, number][] = [];
      for (let e = start + slide; e <= start + size; e += slide) if (e > ts) out.push([start, e]);
      return out;
    }
    case 'session':
      return [[ts, ts + Math.max(1, Number(c.gapMs))]];
    default: {
      const start = ts - (((ts % size) + size) % size);
      return [[start, start + size]];
    }
  }
}

function windowOp(n: PipelineNode, x: Ctx): Operator {
  const c = cfg(n);
  const keyBy = (c.keyBy as string[]) ?? [];
  const aggs = (c.aggregates as Agg[]) ?? [];
  const lateness = Number(c.allowedLatenessMs ?? 0);
  // key → window "start:end" → state
  const state = new Map<
    string,
    Map<string, { start: number; end: number; acc: Acc[]; keyData: Event; fired: boolean }>
  >();
  let wm = -Infinity;
  const add = (acc: Acc[], e: Event) =>
    aggs.forEach((a, i) => {
      const s = acc[i]!;
      const v = e[a.field] ?? null;
      s.n++;
      if (typeof v === 'number') s.sum += v;
      if (v !== null && (s.min === null || rank(v) < rank(s.min))) s.min = v;
      if (v !== null && (s.max === null || rank(v) > rank(s.max))) s.max = v;
    });
  const result = (w: { start: number; end: number; acc: Acc[]; keyData: Event }): SimEvent => {
    const data: Event = { ...w.keyData, window_start: iso(w.start), window_end: iso(w.end) };
    aggs.forEach((a, i) => {
      const s = w.acc[i]!;
      data[a.as] =
        a.fn === 'count'
          ? s.n
          : a.fn === 'sum'
            ? round(s.sum)
            : a.fn === 'avg'
              ? round(s.sum / (s.n || 1))
              : a.fn === 'min'
                ? s.min
                : s.max;
    });
    // FLINK: a window result's timestamp is window.maxTimestamp() = end − 1.
    return { ts: w.end - 1, data };
  };
  const fire = (w: { start: number; end: number; acc: Acc[]; keyData: Event; fired: boolean }) => {
    w.fired = true;
    x.fire(w.end - 1);
    x.emit('main', result(w));
  };
  return {
    process(_p, ev) {
      const key = keyOf(ev.data, keyBy);
      x.keyed(key);
      const ws = state.get(key) ?? new Map();
      state.set(key, ws);
      let live = 0;
      for (let [start, end] of windowsFor(c, ev.ts)) {
        // FLINK: WindowOperator.isWindowLate — maxTimestamp + allowedLateness <= watermark.
        if (end - 1 + lateness <= wm) continue;
        live++;
        if (c.kind === 'session') {
          // Merge every session this one overlaps (MergingWindowAssigner).
          for (const [id, w] of [...ws])
            if (w.start < end && start < w.end) {
              start = Math.min(start, w.start);
              end = Math.max(end, w.end);
              ws.delete(id);
              // ponytail: merged accumulators are rebuilt from the kept one; exact for count/sum/min/max.
              const nw = { start, end, acc: w.acc, keyData: w.keyData, fired: false };
              ws.set(`${start}:${end}`, nw);
            }
        }
        const id = `${start}:${end}`;
        let w = ws.get(id);
        if (!w) {
          w = {
            start,
            end,
            acc: aggs.map(() => ({ n: 0, sum: 0, min: null, max: null })),
            keyData: Object.fromEntries(keyBy.map((k) => [k, ev.data[k] ?? null])),
            fired: false,
          };
          ws.set(id, w);
        }
        add(w.acc, ev.data);
        // FLINK: EventTimeTrigger.onElement fires at once for a late-but-allowed element.
        if (end - 1 <= wm) fire(w);
      }
      // FLINK: all windows late and the element is late → late side output (sideOutputLateData).
      if (!live && ev.ts + lateness <= wm) x.late({ ...ev, reason: 'late' });
    },
    advance(next) {
      wm = next;
      // FLINK: event-time timers fire in timestamp order (InternalTimerService's priority queue).
      const ready = [...state.values()]
        .flatMap((ws) => [...ws.values()])
        .filter((w) => !w.fired && w.end - 1 <= wm)
        .sort((a, b) => a.end - b.end);
      for (const w of ready) fire(w);
      for (const [key, ws] of state) {
        // FLINK: cleanup at maxTimestamp + allowedLateness.
        for (const [id, w] of ws) if (w.end - 1 + lateness <= wm) ws.delete(id);
        if (!ws.size) state.delete(key);
      }
    },
    keys: () => state.size,
  };
}

function joinOp(n: PipelineNode, x: Ctx): Operator {
  const c = cfg(n);
  const lo = (c.lowerMs as number | null) ?? -Infinity;
  const hi = (c.upperMs as number | null) ?? Infinity;
  const left = new Map<string, { ev: SimEvent; matched: boolean }[]>();
  const right = new Map<string, SimEvent[]>();
  const merge = (l: SimEvent, r: SimEvent): SimEvent => ({
    // FLINK: interval join output timestamp = max(left, right).
    ts: Math.max(l.ts, r.ts),
    data: {
      ...l.data,
      ...Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k in l.data ? `right_${k}` : k, v])),
    },
  });
  // FLINK: IntervalJoinOperator — l.ts + lower <= r.ts <= l.ts + upper.
  const ok = (l: SimEvent, r: SimEvent) => r.ts - l.ts >= lo && r.ts - l.ts <= hi;
  return {
    process(port, ev) {
      if (port === 'left') {
        const k = String(ev.data[String(c.leftKey)] ?? '');
        x.keyed(k);
        const rec = { ev, matched: false };
        for (const r of right.get(k) ?? [])
          if (ok(ev, r)) {
            rec.matched = true;
            x.emit('main', merge(ev, r));
          }
        left.set(k, [...(left.get(k) ?? []), rec]);
      } else {
        const k = String(ev.data[String(c.rightKey)] ?? '');
        x.keyed(k);
        for (const l of left.get(k) ?? [])
          if (ok(l.ev, ev)) {
            l.matched = true;
            x.emit('main', merge(l.ev, ev));
          }
        right.set(k, [...(right.get(k) ?? []), ev]);
      }
    },
    advance(wm) {
      // Drop state that can no longer match; a left row leaves unmatched → emitted alone for a left join.
      for (const [k, ls] of left) {
        const keep = ls.filter((l) => l.ev.ts + hi > wm);
        for (const l of ls) if (!keep.includes(l) && !l.matched && c.kind === 'left') x.emit('main', l.ev);
        if (keep.length) left.set(k, keep);
        else left.delete(k);
      }
      for (const [k, rs] of right) {
        const keep = rs.filter((r) => r.ts - lo > wm);
        if (keep.length) right.set(k, keep);
        else right.delete(k);
      }
    },
    keys: () => new Set([...left.keys(), ...right.keys()]).size,
  };
}

function operator(
  n: PipelineNode,
  x: Ctx,
  inSchema: Schema,
  o: Required<Pick<RunOptions, 'refTables'>>,
  labels: Map<string, string>,
): Operator {
  const c = cfg(n);
  const run = compiler(inSchema);
  const test = (expr: string, ev: SimEvent): boolean | null => {
    try {
      return run(expr, ev.data) === true;
    } catch (err) {
      x.fail(ev, `${(err as Error).message}`.split('\n')[0] ?? 'evaluation failed');
      return null;
    }
  };
  if (n.disabled) {
    const first = spec(n.type).outputs(c)[0]?.id;
    return { process: (_p, ev) => first && x.emit(first, ev) };
  }
  switch (n.type) {
    case 'Filter':
      return {
        process: (_p, ev) => {
          const r = test(String(c.expr), ev);
          if (r !== null) x.emit(r ? 'main' : 'rejected', r ? ev : { ...ev, reason: 'filtered out' });
        },
      };
    case 'Validate':
      return {
        process: (_p, ev) => {
          for (const rule of c.rules as { name: string; expr: string }[]) {
            const r = test(rule.expr, ev);
            if (r === null) return;
            if (!r) return x.emit('rejected', { ...ev, reason: rule.name });
          }
          x.emit('main', ev);
        },
      };
    case 'Route':
      return {
        process: (_p, ev) => {
          for (const route of c.routes as { id: string; expr: string }[]) {
            const r = test(route.expr, ev);
            if (r === null) return;
            if (r) return x.emit(`route-${route.id}`, ev);
          }
          if (c.defaultBranch) x.emit('default', ev);
        },
      };
    case 'Map':
      return {
        process: (_p, ev) => {
          const drop = new Set(c.drop as string[]);
          const data: Event = Object.fromEntries(Object.entries(ev.data).filter(([k]) => !drop.has(k)));
          // Assignments see the input event (MORNING D35: evaluated in parallel, like one SELECT).
          for (const a of c.assignments as { field: string; expr: string }[]) {
            try {
              data[a.field] = run(a.expr, ev.data) as Event[string];
            } catch (err) {
              return x.fail(ev, (err as Error).message.split('\n')[0] ?? 'evaluation failed');
            }
          }
          x.emit('main', { ts: ev.ts, data });
        },
      };
    case 'Union': {
      const tag = String(c.tagField ?? '');
      return {
        process: (_p, ev, from) =>
          x.emit('main', tag ? { ...ev, data: { ...ev.data, [tag]: labels.get(from) ?? from } } : ev),
      };
    }
    case 'Deduplicate': {
      const keys = c.key as string[];
      const ttl = (c.ttlMs as number | null) ?? Infinity;
      const seen = new Map<string, number>(); // key → simulation time first seen
      return {
        process: (_p, ev) => {
          const k = keyOf(ev.data, keys);
          x.keyed(k);
          const at = seen.get(k);
          // FLINK: state TTL is by processing time; the simulation clock stands in for it.
          const fresh = at === undefined || x.now() - at >= ttl;
          if (c.keep === 'last') {
            // ponytail: keep-last emits each newer row as an append; retractions (+U/−U) are ENG-04 (v1).
            seen.set(k, x.now());
            return x.emit('main', ev);
          }
          if (fresh) {
            seen.set(k, x.now());
            x.emit('main', ev);
          }
        },
        keys: () => seen.size,
      };
    }
    case 'Top-N': {
      const by = String(c.orderBy);
      const parts = c.partitionBy as string[];
      const dir = c.desc ? -1 : 1;
      const sorted = (es: SimEvent[]) =>
        [...es].sort((a, b) => {
          const p = rank(a.data[by] ?? null);
          const q = rank(b.data[by] ?? null);
          return (p < q ? -1 : p > q ? 1 : 0) * dir;
        });
      if (c.withinWindow) {
        // FLINK: window Top-N ranks per (window_start, window_end, partition) and emits when the window closes.
        const buf = new Map<string, { end: number; es: SimEvent[] }>();
        return {
          process: (_p, ev) => {
            const end = Date.parse(String(ev.data['window_end'] ?? '')) || ev.ts + 1;
            const k = `${end}|${keyOf(ev.data, parts)}`;
            x.keyed(keyOf(ev.data, parts));
            const b = buf.get(k) ?? { end, es: [] };
            b.es.push(ev);
            buf.set(k, b);
          },
          advance: (wm) => {
            for (const [k, b] of buf)
              if (b.end - 1 <= wm) {
                sorted(b.es)
                  .slice(0, Number(c.n))
                  .forEach((ev, i) => x.emit('main', { ts: b.end - 1, data: { ...ev.data, rank: i + 1 } }));
                buf.delete(k);
              }
          },
          keys: () => buf.size,
        };
      }
      // ponytail: continuous Top-N emits a row when it enters the top N; retractions are ENG-04 (v1).
      const top = new Map<string, SimEvent[]>();
      return {
        process: (_p, ev) => {
          const k = keyOf(ev.data, parts);
          x.keyed(k);
          const next = sorted([...(top.get(k) ?? []), ev]).slice(0, Number(c.n));
          top.set(k, next);
          const i = next.indexOf(ev);
          if (i >= 0) x.emit('main', { ...ev, data: { ...ev.data, rank: i + 1 } });
        },
        keys: () => top.size,
      };
    }
    case 'Lookup': {
      const t = o.refTables[String(c.table)];
      const key = String(c.key);
      const tkey = String(c.tableKey);
      return {
        process: (_p, ev) => {
          const rows = (t?.rows ?? []).filter((r) => String(r[tkey]) === String(ev.data[key]));
          // As of event time: the latest version whose valid_from is not after the event (temporal join).
          const row =
            t?.versioned && c.asOf
              ? rows
                  .filter((r) => Date.parse(String(r['valid_from'])) <= ev.ts)
                  .sort(
                    (a, b) => Date.parse(String(b['valid_from'])) - Date.parse(String(a['valid_from'])),
                  )[0]
              : rows[rows.length - 1];
          if (row) {
            const extra = Object.fromEntries(
              Object.entries(row).filter(([k]) => k !== tkey && k !== 'valid_from'),
            );
            return x.emit('main', { ts: ev.ts, data: { ...ev.data, ...extra } });
          }
          if (c.onMiss === 'pass') x.emit('main', ev);
          else if (c.onMiss === 'reject') x.emit('rejected', { ...ev, reason: 'no match' });
        },
      };
    }
    case 'Window':
      return windowOp(n, x);
    case 'Join':
      return joinOp(n, x);
    default:
      // Sink and Dead-letter collect (see createRun); Pattern and SQL are v1: pass through.
      return { process: (_p, ev) => x.emit('main', ev) };
  }
}

/* ---------------- run ---------------- */

export interface Run {
  /** Process the next arrival (one source event through the pipeline). False when there is none. */
  step(): boolean;
  /** Process up to `n` arrivals; at the end of input, flush (final watermark). */
  advance(n: number): void;
  stats(): RunStats;
}

export function createRun(g: Graph, opts: RunOptions = {}): Run {
  const parallelism = opts.parallelism ?? 2;
  const keep = opts.keep ?? 500;
  const refTables = opts.refTables ?? {};
  const s = propagate(g);
  const order = topoOrder(g).filter((n) => !(n.disabled && spec(n.type).category === 'Sources'));
  const labels = new Map(g.nodes.map((n) => [n.id, labelOf(n)]));
  const out = new Map<string, typeof g.edges>();
  const inEdges = new Map<string, typeof g.edges>();
  for (const e of g.edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    inEdges.set(e.target, [...(inEdges.get(e.target) ?? []), e]);
  }

  const stats: RunStats = {
    processed: 0,
    total: 0,
    now: 0,
    nodes: {},
    edges: Object.fromEntries(g.edges.map((e) => [e.id, 0])),
    outputs: {},
    deadLetter: [],
    timeline: [],
    done: false,
  };
  const TIMELINE_MAX = 2000;
  const log = (t: TimelineEntry) => {
    if (stats.timeline.length < TIMELINE_MAX) stats.timeline.push(t);
  };
  const ns = (id: string) =>
    (stats.nodes[id] ??= { in: 0, out: {}, failed: 0, late: 0, watermark: -Infinity });

  // Sources → arrivals, merged in (time, source, sequence) order (SIM-24).
  const arrivals: Arrival[] = [];
  const srcWm = new Map<string, { max: number; ooo: number; idle: number; last: number; left: number }>();
  const sources = order.filter((n) => spec(n.type).category === 'Sources');
  sources.forEach((n, si) => {
    const c = cfg(n);
    const schema = s.out.get(n.id)?.['main'] ?? [];
    const timeField = n.type === 'Source' ? String(c.eventTime || 'event_time') : 'event_time';
    const ooo = n.type === 'Source' ? Number(c.outOfOrdernessMs ?? 0) : GENERATOR_OOO_MS;
    const uploaded = opts.sourceData?.[n.id];
    const evs = uploaded
      ? uploaded.map((data, i) => ({
          at: i * (opts.sourceGapMs?.[n.id] ?? 20),
          ev: { ts: Date.parse(String(data[timeField])) || BASE_TIME, data },
        }))
      : generate(
          schema,
          n.type === 'Generator'
            ? (c as typeof GEN_DEFAULTS & { seed: number })
            : { ...GEN_DEFAULTS, seed: (opts.seed ?? 42) + si },
          timeField,
          ooo,
        );
    evs.forEach((a, seq) => arrivals.push({ at: a.at, src: si, seq, ev: a.ev }));
    srcWm.set(n.id, { max: -Infinity, ooo, idle: Number(c.idleTimeoutMs ?? 0), last: 0, left: evs.length });
  });
  arrivals.sort((a, b) => a.at - b.at || a.src - b.src || a.seq - b.seq);
  stats.total = arrivals.length;

  // Operators
  const ops = new Map<string, Operator>();
  const wmOut = new Map<string, number>();
  const deliver = (from: string, port: string, ev: SimEvent) => {
    const st = ns(from);
    st.out[port] = (st.out[port] ?? 0) + 1;
    for (const e of out.get(from) ?? [])
      if (e.sourceHandle === port) {
        stats.edges[e.id] = (stats.edges[e.id] ?? 0) + 1;
        receive(e.target, e.targetHandle, ev, from);
      }
  };
  const receive = (id: string, port: string, ev: SimEvent, from: string) => {
    ns(id).in++;
    ops.get(id)?.process(port, ev, from);
  };
  for (const n of order) {
    const st = ns(n.id);
    const t = n.type;
    const inSchema = s.in.get(n.id)?.['main']?.[0] ?? s.in.get(n.id)?.['left']?.[0] ?? [];
    const keyed = ['Window', 'Deduplicate', 'Top-N', 'Join'].includes(t);
    if (keyed) st.subtasks = Array.from({ length: parallelism }, () => 0);
    const x: Ctx = {
      emit: (port, ev) => deliver(n.id, port, ev),
      fail: (ev, reason) => {
        st.failed++;
        if (stats.deadLetter.length < keep) stats.deadLetter.push({ node: n.id, reason, data: ev.data });
        log({ kind: 'fail', node: n.id, at: stats.now, ts: ev.ts, watermark: st.watermark, reason });
      },
      late: (ev) => {
        st.late++;
        log({ kind: 'late', node: n.id, at: stats.now, ts: ev.ts, watermark: st.watermark });
        deliver(n.id, 'late', ev);
      },
      fire: (ts) => log({ kind: 'fire', node: n.id, at: stats.now, ts, watermark: st.watermark }),
      now: () => stats.now,
      keyed: (key) => {
        if (st.subtasks) st.subtasks[subtaskOf(key, parallelism)]!++;
      },
    };
    if (t === 'Sink' || t === 'Dead-letter') {
      const rows = (stats.outputs[n.id] = []) as Event[];
      const reasonField = t === 'Dead-letter' ? String(cfg(n).reasonField || 'reason') : '';
      ops.set(n.id, {
        process: (_p, ev) => {
          if (rows.length < keep)
            rows.push(reasonField ? { ...ev.data, [reasonField]: ev.reason ?? null } : ev.data);
        },
      });
    } else if (spec(t).category !== 'Sources') ops.set(n.id, operator(n, x, inSchema, { refTables }, labels));
  }

  // Watermarks: per source (max ts − out-of-orderness − 1), min over a node's active inputs.
  const propagateWm = () => {
    for (const n of order) {
      let wm: number;
      const w = srcWm.get(n.id);
      if (w) {
        // FLINK: BoundedOutOfOrdernessWatermarks emits maxTimestamp − outOfOrderness − 1; a finished
        // bounded source emits Long.MAX_VALUE.
        wm = w.left === 0 ? Infinity : w.max - w.ooo - 1;
      } else {
        const ins = (inEdges.get(n.id) ?? []).filter((e) => {
          const up = srcWm.get(e.source);
          // FLINK: withIdleness — an idle split does not hold back the watermark.
          return !(up && up.idle > 0 && up.left > 0 && stats.now - up.last >= up.idle);
        });
        if (!ins.length) continue;
        wm = Math.min(...ins.map((e) => wmOut.get(e.source) ?? -Infinity));
      }
      const st = ns(n.id);
      if (wm > st.watermark) {
        st.watermark = wm;
        ops.get(n.id)?.advance?.(wm);
      }
      wmOut.set(n.id, st.watermark);
    }
  };

  let i = 0;
  const step = () => {
    const a = arrivals[i];
    if (!a) {
      if (!stats.done) {
        propagateWm();
        stats.done = true;
      }
      return false;
    }
    i++;
    const src = sources[a.src]!;
    stats.now = a.at;
    stats.processed = i;
    const w = srcWm.get(src.id)!;
    w.max = Math.max(w.max, a.ev.ts);
    w.last = a.at;
    w.left--;
    deliver(src.id, 'main', a.ev);
    propagateWm();
    if (i === arrivals.length) {
      stats.done = true;
    }
    return true;
  };

  return {
    step,
    advance: (n) => {
      for (let k = 0; k < n && step(); k++);
    },
    stats: () => {
      for (const [id, op] of ops) if (op.keys) ns(id).keys = op.keys();
      return stats;
    },
  };
}
