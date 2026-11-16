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
import { BUILTIN_TABLES, refSchemas } from './fintech';
import { keyGroupOf, subtaskOf } from './keygroups';
import { BASE_TIME, rng, type Event } from './random';

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
  /** EXPL-02 lineage (trace runs only): this event's id, and the events it came from when an operator says. */
  id?: number;
  parents?: number[];
}

export interface RefTable {
  columns: Schema;
  rows: Event[];
  /** Versioned: rows carry `valid_from` (ISO); as-of lookups pick the latest version ≤ event time. */
  versioned?: boolean;
}

/** EXPL-02: one step of an event's path — which node emitted it, on which port, from which events. */
export interface TraceHop {
  id: number;
  node: string;
  port: string;
  parents: number[];
  ts: number;
  data: Event;
  reason?: string;
  /** The emitting node's watermark at that moment, and the run's clock. */
  watermark: number;
  at: number;
}
export interface Trace {
  hops: Map<number, TraceHop>;
  /** Per Sink / Dead-letter, the id of each output row, in the order of stats().outputs. */
  outputs: Record<string, number[]>;
}

export interface RunOptions {
  /** EXPL-02 explain mode: record every event's lineage (costs memory; off for normal runs). */
  trace?: boolean;
  /** Pipeline-level seed for sources that are not Generators. */
  seed?: number;
  /** The pipeline's data generator (Data drawer, DATA-01) for Sources with no uploaded rows. */
  generator?: Partial<typeof GEN_DEFAULTS> & { seed?: number };
  /** Simulated subtasks per keyed operator (ENG-03). */
  parallelism?: number;
  refTables?: Record<string, RefTable>;
  /** Uploaded rows per Source node id (DATA-02); otherwise sources generate. */
  sourceData?: Record<string, Event[]>;
  /** Arrival spacing per uploaded source (ms of simulation clock); default 20. */
  sourceGapMs?: Record<string, number>;
  /** Cap on rows kept per sink / dead-letter for the Output tab. */
  keep?: number;
  /** Events per source instead of the Generator's count (the drawer preview uses 5 or 50). */
  sample?: number;
  /** Record what this node receives and emits (preview, NODE-04). */
  tap?: string;
  /**
   * Finished sources keep their last watermark until one more step() after the input ends, so open state can
   * be read before the final flush (the preview's "state per key").
   */
  holdFinalWatermark?: boolean;
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
  /** ENG-03 stage inspector: the busiest keys (up to 50) and where they run. */
  keyRouting?: { key: string; keyGroup: number; subtask: number; events: number }[];
  /** Keys held in state. */
  keys?: number;
}

export interface TimelineEntry {
  /** event: a sampled arrival (event time vs clock); watermark: a source's watermark, sampled. */
  kind: 'fire' | 'late' | 'fail' | 'watermark' | 'event';
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

export { BASE_TIME };
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

const BLOCKLISTED = ['m_103', 'm_107', 'm_110']; // the built-in blocklist table's merchants

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
    /** DATA-05: % of events for the top 1% of cards (0 = uniform). */
    skewPct?: number;
    patterns?: { burst: boolean; blocklisted: boolean };
  },
  timeField = 'event_time',
  oooMs = GENERATOR_OOO_MS,
): { at: number; ev: SimEvent }[] {
  const r = rng(c.seed);
  const gap = 1000 / Math.max(1, c.rate);
  const out: { at: number; ev: SimEvent }[] = [];
  // Key skew: the top 1% of cards (at least one) get skewPct % of events. No extra draws when off, so a run
  // without skew is the same run as before the setting existed.
  const top = Math.max(1, Math.ceil(c.keys / 100));
  const card = () => (c.skewPct && r() * 100 < c.skewPct ? Math.floor(r() * top) : Math.floor(r() * c.keys));
  const burstAt = Math.floor(c.count * 0.3);
  // As before: no burst in a run too short for 8, or with no card to repeat.
  const burst = !!c.patterns?.burst && c.count >= 8 && schema.some((f) => f.name === 'card_id');
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
              ? `c_${1000 + card()}`
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
    // DATA-05 built-in fraud patterns, applied to the payment itself (before its duplicate is copied and before
    // the malformed step), by payment number: the draws above happen either way, so a run without them is unchanged.
    if (burst && i >= burstAt && i < burstAt + 8) {
      // Card testing: one card makes 8 small payments in a row, 30% of the way in.
      if ('card_id' in data) data['card_id'] = `c_${1000 + c.keys - 1}`;
      if ('amount' in data) data['amount'] = 1 + (i - burstAt) * 0.5;
      if ('status' in data) data['status'] = 'approved';
    }
    if (c.patterns?.blocklisted && i % 25 === 12 && 'merchant_id' in data)
      // Every 25th payment goes to a merchant on the built-in blocklist.
      data['merchant_id'] = BLOCKLISTED[Math.floor(i / 25) % 3]!;
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
  /** A keyed event (ENG-03); null = the operator is not keyed (one subtask, as Flink's windowAll / global rank). */
  keyed: (key: string | null) => void;
}

interface Operator {
  process(port: string, ev: SimEvent, from: string): void;
  /** Called when the input watermark advances (before it is forwarded downstream). */
  advance?(wm: number): void;
  keys?(): number;
  /** Output watermark = input watermark − delay (interval join). */
  delay?: number;
  /** Open state per key, as rows (NODE-04 "state per key"). */
  snapshot?(): Event[];
}

/**
 * Event time from an uploaded value: epoch ms as a number, or ISO text. Text without a zone is UTC, so runs do
 * not depend on the machine's time zone (SIM-24). NaN when unreadable.
 */
export function parseTime(v: unknown): number {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  const iso = t.replace(' ', 'T');
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

const keyOf = (e: Event, keys: string[]) => keys.map((k) => String(e[k] ?? '∅')).join('|');
const iso = (ms: number) => new Date(ms).toISOString();
const round = (x: number) => Math.round(x * 100) / 100;

interface Agg {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field: string;
  as: string;
}
/** n: rows; nn: non-null values (COUNT(field), SUM and AVG skip nulls, as in SQL). */
type Acc = { n: number; nn: number; sum: number; min: Event[string]; max: Event[string] };
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
      // Size must be a multiple of the step (WIN-SIZE; Flink rejects it at planning).
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

interface Win {
  key: string;
  start: number;
  end: number;
  acc: Acc[];
  keyData: Event;
  fired: boolean;
  /** EXPL-02: ids of the events in the window (trace runs). */
  members?: number[];
  /** Merged into another session or cleaned up: its pending timers are ignored. */
  dead: boolean;
}

/** Timers by timestamp, popped in timestamp order (InternalTimerService's queue), without scanning all state. */
class Timers {
  private at = new Map<number, Win[]>();
  private times: number[] = [];
  add(t: number, w: Win) {
    const list = this.at.get(t);
    if (list) return void list.push(w);
    this.at.set(t, [w]);
    // Binary insert: timer times are few (windows share ends) and mostly arrive in order.
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    this.times.splice(lo, 0, t);
  }
  /** Every window whose timer is ≤ wm, in timer order. */
  *due(wm: number) {
    while (this.times.length && this.times[0]! <= wm) {
      const t = this.times.shift()!;
      const ws = this.at.get(t)!;
      this.at.delete(t);
      yield* ws;
    }
  }
}

function windowOp(n: PipelineNode, x: Ctx): Operator {
  const c = cfg(n);
  const keyBy = (c.keyBy as string[]) ?? [];
  const aggs = (c.aggregates as Agg[]) ?? [];
  const lateness = Number(c.allowedLatenessMs ?? 0);
  const session = c.kind === 'session';
  // key → window "start:end" → state
  const state = new Map<string, Map<string, Win>>();
  const fireAt = new Timers(); // end − 1
  const cleanAt = new Timers(); // end − 1 + allowed lateness
  let wm = -Infinity;
  const blank = (): Acc[] => aggs.map(() => ({ n: 0, nn: 0, sum: 0, min: null, max: null }));
  const add = (acc: Acc[], e: Event) =>
    aggs.forEach((a, i) => {
      const s = acc[i]!;
      const v = a.field ? (e[a.field] ?? null) : null;
      s.n++;
      if (v === null) return;
      s.nn++;
      if (typeof v === 'number') s.sum += v;
      if (s.min === null || rank(v) < rank(s.min)) s.min = v;
      if (s.max === null || rank(v) > rank(s.max)) s.max = v;
    });
  const combine = (into: Acc[], from: Acc[]) =>
    into.forEach((s, i) => {
      const f = from[i]!;
      s.n += f.n;
      s.nn += f.nn;
      s.sum += f.sum;
      if (f.min !== null && (s.min === null || rank(f.min) < rank(s.min))) s.min = f.min;
      if (f.max !== null && (s.max === null || rank(f.max) > rank(s.max))) s.max = f.max;
    });
  const result = (w: Win): SimEvent => {
    const data: Event = { ...w.keyData, window_start: iso(w.start), window_end: iso(w.end) };
    aggs.forEach((a, i) => {
      const s = w.acc[i]!;
      data[a.as] =
        a.fn === 'count'
          ? a.field
            ? s.nn
            : s.n
          : a.fn === 'sum'
            ? s.nn
              ? round(s.sum)
              : null
            : a.fn === 'avg'
              ? s.nn
                ? round(s.sum / s.nn)
                : null
              : a.fn === 'min'
                ? s.min
                : s.max;
    });
    // FLINK: a window result's timestamp is window.maxTimestamp() = end − 1.
    return { ts: w.end - 1, data, ...(w.members ? { parents: [...w.members] } : {}) };
  };
  const fire = (w: Win) => {
    w.fired = true;
    x.fire(w.end - 1);
    x.emit('main', result(w));
  };
  const put = (ws: Map<string, Win>, w: Win) => {
    ws.set(`${w.start}:${w.end}`, w);
    fireAt.add(w.end - 1, w);
    cleanAt.add(w.end - 1 + lateness, w);
  };
  return {
    process(_p, ev) {
      const key = keyOf(ev.data, keyBy);
      x.keyed(keyBy.length ? key : null);
      let ws = state.get(key);
      if (!ws) state.set(key, (ws = new Map()));
      let live = 0;
      for (let [start, end] of windowsFor(c, ev.ts)) {
        const merged: Win[] = [];
        if (session) {
          // FLINK: MergingWindowSet.addWindow first — every session this one intersects (inclusive, as
          // TimeWindow.intersects) merges into one, keeping all their accumulators.
          for (let grew = true; grew;) {
            grew = false;
            for (const w of ws.values())
              if (!merged.includes(w) && w.start <= end && start <= w.end) {
                merged.push(w);
                start = Math.min(start, w.start);
                end = Math.max(end, w.end);
                grew = true;
              }
          }
        }
        // FLINK: WindowOperator.isWindowLate (on the merged window) — maxTimestamp + allowedLateness <= wm.
        if (end - 1 + lateness <= wm) continue;
        live++;
        let w = ws.get(`${start}:${end}`);
        if (merged.length && !(merged.length === 1 && merged[0] === w)) {
          const nw: Win = {
            key,
            start,
            end,
            acc: blank(),
            keyData: merged[0]!.keyData,
            fired: false,
            dead: false,
          };
          for (const m of merged) {
            combine(nw.acc, m.acc);
            if (m.members) (nw.members ??= []).push(...m.members);
            m.dead = true;
            ws.delete(`${m.start}:${m.end}`);
          }
          put(ws, nw);
          w = nw;
        }
        if (!w) {
          w = {
            key,
            start,
            end,
            acc: blank(),
            keyData: Object.fromEntries(keyBy.map((k) => [k, ev.data[k] ?? null])),
            fired: false,
            dead: false,
          };
          put(ws, w);
        }
        add(w.acc, ev.data);
        if (ev.id !== undefined) (w.members ??= []).push(ev.id);
        // FLINK: EventTimeTrigger.onElement fires at once for a late-but-allowed element.
        if (end - 1 <= wm) fire(w);
      }
      // FLINK: all windows late and the element is late → late side output (sideOutputLateData).
      if (!live && ev.ts + lateness <= wm) x.late({ ...ev, reason: 'late' });
    },
    advance(next) {
      wm = next;
      for (const w of fireAt.due(wm)) if (!w.dead && !w.fired) fire(w);
      // FLINK: cleanup at maxTimestamp + allowedLateness.
      for (const w of cleanAt.due(wm)) {
        if (w.dead) continue;
        w.dead = true;
        const ws = state.get(w.key);
        ws?.delete(`${w.start}:${w.end}`);
        if (ws && !ws.size) state.delete(w.key);
      }
    },
    keys: () => state.size,
    snapshot: () =>
      [...state.values()].flatMap((ws) =>
        [...ws.values()].map((w) => {
          const r = result(w).data;
          // Board W10y: key, window as a range, then the aggregates.
          const hm = (ms: number) => iso(ms).slice(11, 19);
          const vals = Object.entries(r).filter(
            ([k]) => !(k in w.keyData) && k !== 'window_start' && k !== 'window_end',
          );
          return { ...w.keyData, window: `${hm(w.start)}–${hm(w.end)}`, ...Object.fromEntries(vals) };
        }),
      ),
  };
}

function joinOp(n: PipelineNode, x: Ctx, rightSchema: Schema): Operator {
  const c = cfg(n);
  const lo = (c.lowerMs as number | null) ?? -Infinity;
  const hi = (c.upperMs as number | null) ?? Infinity;
  const left = new Map<string, { ev: SimEvent; matched: boolean }[]>();
  const right = new Map<string, SimEvent[]>();
  const rename = (k: string, l: Event) => (k in l ? `right_${k}` : k);
  const merge = (l: SimEvent, r: SimEvent): SimEvent => ({
    ...(l.id !== undefined && r.id !== undefined ? { parents: [l.id, r.id] } : {}),
    // FLINK: interval join output timestamp = max(left, right).
    ts: Math.max(l.ts, r.ts),
    data: {
      ...l.data,
      ...Object.fromEntries(Object.entries(r.data).map(([k, v]) => [rename(k, l.data), v])),
    },
  });
  // A left row with no match is padded with the right side's fields as NULL (join.ts output schema).
  const pad = (l: SimEvent): SimEvent => ({
    ...(l.id !== undefined ? { parents: [l.id] } : {}),
    ts: l.ts,
    data: { ...l.data, ...Object.fromEntries(rightSchema.map((f) => [rename(f.name, l.data), null])) },
  });
  // FLINK: IntervalJoinOperator — l.ts + lower <= r.ts <= l.ts + upper.
  const ok = (l: SimEvent, r: SimEvent) => r.ts - l.ts >= lo && r.ts - l.ts <= hi;
  let nulls = 0;
  return {
    // FLINK: the SQL row-time interval join (KeyedCoProcessOperatorWithWatermarkDelay) holds its output
    // watermark back by max(−lower, upper), so rows it emits late (left-join padding) are not late downstream.
    delay: Number.isFinite(lo) && Number.isFinite(hi) ? Math.max(-lo, hi, 0) : 0,
    process(port, ev) {
      const raw = ev.data[String(port === 'left' ? c.leftKey : c.rightKey)] ?? null;
      // NULL keys never match (SQL equi-join): a left row with one waits alone, for padding.
      const k = raw === null ? `\u0000null${nulls++}` : String(raw);
      x.keyed(raw === null ? NULL_KEY : String(raw)); // a NULL key is not the text "null"
      if (port === 'left') {
        const rec = { ev, matched: false };
        for (const r of right.get(k) ?? [])
          if (ok(ev, r)) {
            rec.matched = true;
            x.emit('main', merge(ev, r));
          }
        left.set(k, [...(left.get(k) ?? []), rec]);
      } else {
        if (raw === null) return;
        for (const l of left.get(k) ?? [])
          if (ok(l.ev, ev)) {
            l.matched = true;
            x.emit('main', merge(l.ev, ev));
          }
        right.set(k, [...(right.get(k) ?? []), ev]);
      }
    },
    advance(wm) {
      // Drop state that can no longer match; a left row leaves unmatched → emitted padded for a left join.
      for (const [k, ls] of left) {
        const keep = ls.filter((l) => l.ev.ts + hi > wm);
        for (const l of ls)
          if (!keep.includes(l) && !l.matched && c.kind === 'left') x.emit('main', pad(l.ev));
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
  rightSchema: Schema,
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
    // Disabled: the first input port passes through to the first output (not every input or branch).
    const first = spec(n.type).outputs(c)[0]?.id;
    const inPort = spec(n.type).inputs(c)[0]?.id ?? 'main';
    return { process: (p, ev) => p === inPort && first && x.emit(first, ev) };
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
        snapshot: () =>
          [...seen].map(([k, at]) => ({
            key: k.replaceAll('|', ' · '),
            first_seen: `${(at / 1000).toFixed(1)} s into the run`,
          })),
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
        let wm = -Infinity;
        return {
          process: (_p, ev) => {
            const end = Date.parse(String(ev.data['window_end'] ?? '')) || ev.ts + 1;
            // FLINK: a record for a window already ranked is late and dropped (numLateRecordsDropped).
            if (end - 1 <= wm) return;
            const k = `${end}|${keyOf(ev.data, parts)}`;
            x.keyed(parts.length ? keyOf(ev.data, parts) : null);
            const b = buf.get(k) ?? { end, es: [] };
            b.es.push(ev);
            buf.set(k, b);
          },
          advance: (next) => {
            wm = next;
            for (const [k, b] of buf)
              if (b.end - 1 <= wm) {
                sorted(b.es)
                  .slice(0, Number(c.n))
                  .forEach((ev, i) =>
                    x.emit('main', {
                      ts: b.end - 1,
                      data: { ...ev.data, rank: i + 1 },
                      ...(ev.id !== undefined ? { parents: [ev.id] } : {}),
                    }),
                  );
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
          x.keyed(parts.length ? k : null);
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
      // Index once: per key, the versions sorted by valid_from (binary search per event, not a scan).
      const byKey = new Map<string, { t: number; row: Event }[]>();
      for (const r of t?.rows ?? []) {
        if (r[tkey] == null) continue;
        const k = String(r[tkey]);
        const list = byKey.get(k) ?? [];
        list.push({ t: t?.versioned ? parseTime(r['valid_from']) : 0, row: r });
        byKey.set(k, list);
      }
      for (const list of byKey.values()) list.sort((a, b) => a.t - b.t);
      const versionAt = (list: { t: number; row: Event }[], at: number) => {
        let lo = 0;
        let hi = list.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (list[mid]!.t <= at) {
            found = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        return found < 0 ? undefined : list[found]!.row;
      };
      // Same rename as the schema (graph merge): a column the event already has arrives as right_<name>.
      const inNames = new Set(inSchema.map((f) => f.name));
      return {
        process: (_p, ev) => {
          // NULL never equals anything (SQL equi-join).
          const v = ev.data[key] ?? null;
          const list = v === null ? undefined : byKey.get(String(v));
          // FLINK: FOR SYSTEM_TIME AS OF the event's rowtime picks the version valid at the event time (temporal
          // join); without it, a lookup join reads the table as it is now — the simulation clock here.
          // https://nightlies.apache.org/flink/flink-docs-release-2.2/docs/dev/table/sql/queries/joins/#temporal-joins
          // ponytail: Flink's event-time temporal join waits for the watermark before emitting; this emits at once
          // (same rows, earlier).
          const row =
            list && (t?.versioned ? versionAt(list, c.asOf ? ev.ts : BASE_TIME + x.now()) : list.at(-1)?.row);
          if (row) {
            const data: Event = { ...ev.data };
            for (const [k, val] of Object.entries(row))
              if (k !== tkey && k !== 'valid_from') data[inNames.has(k) ? `right_${k}` : k] = val; // schema names only, exactly as graph merge()
            return x.emit('main', { ts: ev.ts, data });
          }
          if (c.onMiss === 'pass') x.emit('main', ev);
          else if (c.onMiss === 'reject') x.emit('rejected', { ...ev, reason: 'no match' });
        },
      };
    }
    case 'Window':
      return windowOp(n, x);
    case 'Join':
      return joinOp(n, x, rightSchema);
    default:
      // Sink and Dead-letter collect (see createRun); Pattern and SQL are v1: pass through.
      return { process: (_p, ev) => x.emit('main', ev) };
  }
}

/** ENG-03 display keys: a NULL key, and all events of an operator that is not keyed. */
export const NULL_KEY = '∅';
export const ALL_KEYS = '(all events)';

/* ---------------- run ---------------- */

/**
 * The pipeline's watermark: the slowest node's. Nodes that never receive anything (fed only by a disabled source)
 * do not count — they would hold it at −∞ forever. −∞ until every active path has one.
 */
export function pipelineWatermark(stats: RunStats): number {
  let wm = Infinity;
  let any = false;
  for (const x of Object.values(stats.nodes))
    if (Number.isFinite(x.watermark) || x.in > 0 || x.watermark === Infinity) {
      any = true;
      wm = Math.min(wm, x.watermark);
    }
  return any ? wm : -Infinity;
}

export interface ChaosReport {
  late: number;
  duplicates: number;
  malformed: number;
  /** The source whose events were delayed (null when nothing was left to run). */
  stalled: string | null;
  stallMs: number;
}

export interface Run {
  /** Process the next arrival (one source event through the pipeline). False when there is none. */
  step(): boolean;
  /** Process up to `n` arrivals; at the end of input, flush (final watermark). */
  advance(n: number): void;
  stats(): RunStats;
  /** What the `tap` node received and emitted, per port. */
  tapped(): { input: Record<string, Event[]>; output: Record<string, Event[]> };
  /** Open state of a stateful node (see RunOptions.holdFinalWatermark). */
  snapshot(id: string): Event[] | undefined;
  /**
   * SIM-16 Chaos: inject late, duplicate and malformed events now, and stall one source (its next events arrive
   * `stallMs` later). Returns what was done, for the pill to say.
   */
  inject(c?: { late?: number; duplicates?: number; malformed?: number; stallMs?: number }): ChaosReport;
  /** Simulation time of the next arrival, or undefined at the end of input. */
  next(): number | undefined;
  /** EXPL-02 lineage, when the run was made with `trace`; null otherwise. */
  trace(): Trace | null;
}

export function createRun(g: Graph, opts: RunOptions = {}): Run {
  const parallelism = opts.parallelism ?? 2;
  const keep = opts.keep ?? 500;
  // DATA-05: the fintech pack's tables are always there; uploaded tables add to (or replace) them.
  const refTables = { ...opts.refTables, ...BUILTIN_TABLES }; // built-in names win (DATA-03)
  const s = propagate(g, { refTables: refSchemas(refTables) });
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
  // Samples (event, watermark) have their own cap, so they never crowd out fires, late events and failures.
  const SAMPLES_MAX = 4000;
  const MARKS_MAX = 10000;
  let samples = 0;
  let marks = 0;
  const log = (t: TimelineEntry) => {
    const sample = t.kind === 'event' || t.kind === 'watermark';
    if (sample ? samples++ < SAMPLES_MAX : marks++ < MARKS_MAX) stats.timeline.push(t);
  };
  const ns = (id: string) =>
    (stats.nodes[id] ??= { in: 0, out: {}, failed: 0, late: 0, watermark: -Infinity });

  // Sources → arrivals, merged in (time, source, sequence) order (SIM-24).
  const arrivals: Arrival[] = [];
  const srcWm = new Map<
    string,
    { max: number; ooo: number; idle: number; last: number; left: number; field: string }
  >();
  const sources = order.filter((n) => spec(n.type).category === 'Sources');
  sources.forEach((n, si) => {
    const c = cfg(n);
    const schema = s.out.get(n.id)?.['main'] ?? [];
    const timeField = n.type === 'Source' ? String(c.eventTime || 'event_time') : 'event_time';
    const ooo = n.type === 'Source' ? Number(c.outOfOrdernessMs ?? 0) : GENERATOR_OOO_MS;
    const all = opts.sourceData?.[n.id];
    // The preview samples uploads too: their first `sample` rows.
    const uploaded = all && opts.sample ? all.slice(0, opts.sample) : all;
    const evs = uploaded
      ? uploaded.map((data, i) => ({
          at: i * (opts.sourceGapMs?.[n.id] ?? 20),
          // ponytail: an unreadable time falls back to BASE_TIME; the upload step reports it (DATA-PARSE, DATA-02).
          ev: { ts: Number.isNaN(parseTime(data[timeField])) ? BASE_TIME : parseTime(data[timeField]), data },
        }))
      : generate(
          schema,
          n.type === 'Generator'
            ? {
                ...(c as typeof GEN_DEFAULTS & { seed: number }),
                ...(opts.sample ? { count: opts.sample } : {}),
              }
            : {
                ...GEN_DEFAULTS,
                ...opts.generator,
                // Each Source gets its own stream from the same seed.
                seed: (opts.generator?.seed ?? opts.seed ?? 42) + si,
                ...(opts.sample ? { count: opts.sample } : {}),
              },
          timeField,
          ooo,
        );
    evs.forEach((a, seq) => arrivals.push({ at: a.at, src: si, seq, ev: a.ev }));
    srcWm.set(n.id, {
      max: -Infinity,
      ooo,
      idle: Number(c.idleTimeoutMs ?? 0),
      last: 0,
      left: evs.length,
      field: timeField,
    });
  });
  arrivals.sort((a, b) => a.at - b.at || a.src - b.src || a.seq - b.seq);
  stats.total = arrivals.length;
  // Timeline sampling: every 250 ms of clock, or sparser on long runs so ~500 samples per series span the run.
  const sampleEvery = Math.max(250, (arrivals.at(-1)?.at ?? 0) / 500);

  // Operators
  const ops = new Map<string, Operator>();
  const wmOut = new Map<string, number>();
  // EXPL-02 lineage: what is being processed now is the parent of what is emitted, unless the operator says.
  const trace: Trace | null = opts.trace ? { hops: new Map(), outputs: {} } : null;
  let nextId = 0;
  let current: number[] = [];
  const record = (node: string, port: string, ev: SimEvent): SimEvent => {
    if (!trace) return ev;
    const id = ++nextId;
    const parents = ev.parents ?? current;
    const st = ns(node);
    trace.hops.set(id, {
      id,
      node,
      port,
      parents,
      ts: ev.ts,
      data: ev.data,
      ...(ev.reason ? { reason: ev.reason } : {}),
      watermark: st.watermark,
      at: stats.now,
    });
    const { parents: _p, ...rest } = ev;
    void _p;
    return { ...rest, id };
  };
  const deliver = (from: string, port: string, raw: SimEvent) => {
    const ev = record(from, port, raw);
    const st = ns(from);
    st.out[port] = (st.out[port] ?? 0) + 1;
    if (from === opts.tap) (tapped.output[port] ??= []).push(ev.data);
    for (const e of out.get(from) ?? [])
      if (e.sourceHandle === port) {
        stats.edges[e.id] = (stats.edges[e.id] ?? 0) + 1;
        receive(e.target, e.targetHandle, ev, from);
      }
  };
  const tapped = { input: {} as Record<string, Event[]>, output: {} as Record<string, Event[]> };
  const receive = (id: string, port: string, ev: SimEvent, from: string) => {
    ns(id).in++;
    if (id === opts.tap) (tapped.input[port] ??= []).push(ev.data);
    const before = current;
    current = ev.id !== undefined ? [ev.id] : [];
    ops.get(id)?.process(port, ev, from);
    current = before;
  };
  // SIM-RUNTIME-EXPR dead letter: the enabled Dead-letter node this node feeds, else the first enabled one.
  const routing = new Map<string, Map<string, number>>(); // keyed node → events per key (ENG-03)
  let routedAt = -1;
  const dlqIds = new Set(order.filter((n) => n.type === 'Dead-letter' && !n.disabled).map((n) => n.id));
  const deadLetterFor = (id: string) =>
    (out.get(id) ?? []).find((e) => dlqIds.has(e.target))?.target ?? [...dlqIds][0];
  for (const n of order) {
    const st = ns(n.id);
    const t = n.type;
    const inSchema = s.in.get(n.id)?.['main']?.[0] ?? s.in.get(n.id)?.['left']?.[0] ?? [];
    const keyed = ['Window', 'Deduplicate', 'Top-N', 'Join'].includes(t);
    if (keyed) st.subtasks = Array.from({ length: parallelism }, () => 0);
    const keyCounts = new Map<string, number>();
    if (keyed) routing.set(n.id, keyCounts);
    const x: Ctx = {
      emit: (port, ev) => deliver(n.id, port, ev),
      fail: (ev, reason) => {
        st.failed++;
        if (stats.deadLetter.length < keep) stats.deadLetter.push({ node: n.id, reason, data: ev.data });
        log({ kind: 'fail', node: n.id, at: stats.now, ts: ev.ts, watermark: st.watermark, reason });
        // SIM-RUNTIME-EXPR: "They were sent to Dead-letter" — every Dead-letter node receives the event.
        const d = deadLetterFor(n.id);
        if (d) receive(d, 'main', record(n.id, 'dead-letter', { ...ev, reason }), n.id);
      },
      late: (ev) => {
        st.late++;
        log({ kind: 'late', node: n.id, at: stats.now, ts: ev.ts, watermark: st.watermark });
        deliver(n.id, 'late', ev);
      },
      fire: (ts) => log({ kind: 'fire', node: n.id, at: stats.now, ts, watermark: st.watermark }),
      now: () => stats.now,
      keyed: (key) => {
        if (!st.subtasks) return;
        st.subtasks[key === null ? 0 : subtaskOf(key, parallelism)]!++;
        const k = key ?? ALL_KEYS;
        keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
      },
    };
    if (t === 'Sink' || t === 'Dead-letter') {
      const rows = (stats.outputs[n.id] = []) as Event[];
      const ids = trace ? (trace.outputs[n.id] = [] as number[]) : null;
      const reasonField = t === 'Dead-letter' ? String(cfg(n).reasonField || 'reason') : '';
      ops.set(n.id, {
        process: (_p, ev) => {
          if (rows.length < keep) {
            rows.push(reasonField ? { ...ev.data, [reasonField]: ev.reason ?? null } : ev.data);
            if (ids && ev.id !== undefined) ids.push(ev.id);
          }
        },
      });
    } else if (spec(t).category !== 'Sources')
      ops.set(n.id, operator(n, x, inSchema, s.in.get(n.id)?.['right']?.[0] ?? [], { refTables }, labels));
  }

  // Watermarks: per source (max ts − out-of-orderness − 1), min over a node's active inputs.
  const included = new Set(order.map((n) => n.id));
  const idleOut = new Map<string, boolean>();
  const propagateWm = () => {
    for (const n of order) {
      let wm: number;
      let idle: boolean;
      const w = srcWm.get(n.id);
      if (w) {
        // FLINK: BoundedOutOfOrdernessWatermarks emits maxTimestamp − outOfOrderness − 1; a finished
        // bounded source emits Long.MAX_VALUE.
        wm = w.left === 0 && (!opts.holdFinalWatermark || ended) ? Infinity : w.max - w.ooo - 1;
        // FLINK: withIdleness — no events for idleTimeout marks the source idle.
        idle = w.idle > 0 && w.left > 0 && stats.now - w.last >= w.idle;
      } else {
        // A disabled source sends nothing, not even watermarks: it is not an input (graph.ts agrees).
        const ins = (inEdges.get(n.id) ?? []).filter((e) => included.has(e.source));
        if (!ins.length) continue;
        // FLINK: WatermarkStatus.IDLE travels through operators; an idle input does not hold back the min.
        const active = ins.filter((e) => !idleOut.get(e.source));
        idle = active.length === 0;
        if (idle) {
          idleOut.set(n.id, true);
          continue;
        }
        wm = Math.min(...active.map((e) => wmOut.get(e.source) ?? -Infinity));
      }
      idleOut.set(n.id, idle);
      const st = ns(n.id);
      if (wm > st.watermark) {
        st.watermark = wm;
        ops.get(n.id)?.advance?.(wm);
      }
      // A join holds its output watermark back (see joinOp's delay).
      wmOut.set(n.id, st.watermark - (ops.get(n.id)?.delay ?? 0));
    }
  };

  let i = 0;
  let ended = false;
  const lastSample = new Map<string, number>();
  let lastWmSample = -Infinity;
  const step = () => {
    const a = arrivals[i];
    if (!a) {
      if (!ended) {
        ended = true;
        propagateWm();
      }
      stats.done = true;
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
    // SIM-21 Timeline samples: per source, at most one event per 250 ms of clock.
    if (stats.now - (lastSample.get(src.id) ?? -Infinity) >= sampleEvery) {
      lastSample.set(src.id, stats.now);
      log({ kind: 'event', node: src.id, at: stats.now, ts: a.ev.ts, watermark: ns(src.id).watermark });
    }
    deliver(src.id, 'main', a.ev);
    propagateWm();
    // The pipeline's watermark: the slowest node's (what the pill shows), not one source's.
    if (stats.now - lastWmSample >= sampleEvery) {
      const wm = pipelineWatermark(stats);
      if (Number.isFinite(wm)) {
        lastWmSample = stats.now;
        log({ kind: 'watermark', node: '', at: stats.now, ts: wm, watermark: wm });
      }
    }
    if (i === arrivals.length && !opts.holdFinalWatermark) stats.done = true;
    return true;
  };

  return {
    step,
    next: () => arrivals[i]?.at,
    trace: () => trace,
    inject: (c = {}) => {
      const lateN = c.late ?? 5;
      const dupN = c.duplicates ?? 5;
      const badN = c.malformed ?? 5;
      const stallMs = c.stallMs ?? 3000;
      const upcoming = arrivals.slice(i);
      const report: ChaosReport = { late: 0, duplicates: 0, malformed: 0, stalled: null, stallMs };
      if (!upcoming.length) return report;
      const at = stats.now;
      // Copies of events already emitted (never of future ones): a copy of a future event would push its
      // source's watermark ahead and make the real events in between late.
      // Never copies of earlier chaos (seq −1), and only sources still running: a finished source has passed
      // its final watermark, so any copy of it would be late everywhere.
      const past = arrivals
        .slice(Math.max(0, i - 400), i)
        .reverse()
        .filter((a) => a.seq >= 0 && srcWm.get(sources[a.src]!.id)!.left > 0)
        .slice(0, 200);
      const extra: Arrival[] = [];
      const add = (a: Arrival, ev: SimEvent) => {
        extra.push({ ...a, at, seq: -1, ev });
        srcWm.get(sources[a.src]!.id)!.left++;
      };
      let k = 0;
      // A minute behind the pipeline's watermark (the slowest input's), so windows that already fired send them
      // to the late output. With no watermark yet (an input has not started) there is nothing to be late against.
      const pwm = pipelineWatermark(stats);
      for (const a of past) {
        if (report.late >= lateN || !Number.isFinite(pwm)) break;
        const w = srcWm.get(sources[a.src]!.id)!;
        const ts = pwm - 60_000;
        add(a, { ts, data: { ...a.ev.data, [w.field]: new Date(ts).toISOString() } });
        report.late++;
        k++;
      }
      for (const a of past.slice(k, k + dupN)) {
        add(a, { ...a.ev, data: { ...a.ev.data } });
        report.duplicates++;
      }
      for (const a of past.slice(k + dupN, k + dupN + badN)) {
        const schema = s.out.get(sources[a.src]!.id)?.['main'] ?? [];
        const num = schema.find((f) => f.type === 'number' && f.required);
        if (!num) continue; // nothing to break: not counted
        add(a, { ...a.ev, data: { ...a.ev.data, [num.name]: null } });
        report.malformed++;
      }
      // Stall the first source that still has events: its remaining arrivals come `stallMs` later.
      if (stallMs > 0) {
        const stalled = upcoming[0]!.src;
        for (const a of upcoming) if (a.src === stalled) a.at += stallMs;
        report.stalled = sources[stalled]!.id;
      }
      const rest = [...extra, ...upcoming].sort((a, b) => a.at - b.at || a.src - b.src || a.seq - b.seq);
      arrivals.splice(i, arrivals.length - i, ...rest);
      stats.total = arrivals.length;
      return report;
    },
    advance: (n) => {
      for (let k = 0; k < n && step(); k++);
    },
    tapped: () => tapped,
    snapshot: (id) => ops.get(id)?.snapshot?.(),
    stats: () => {
      // Recomputed whenever events were processed since the last time (steps and pauses included): one
      // pass keeping the top 50, not a sort of every key.
      if (stats.processed !== routedAt || stats.done) {
        routedAt = stats.processed;
        for (const [id, counts] of routing) {
          const top: [string, number][] = [];
          for (const e of counts) {
            const last = top[49];
            // Below the 50th (or tied with it but later by key): not in the top 50.
            if (last && (e[1] < last[1] || (e[1] === last[1] && e[0] >= last[0]))) continue;
            let at = top.findIndex((t) => e[1] > t[1] || (e[1] === t[1] && e[0] < t[0]));
            if (at < 0) at = top.length;
            top.splice(at, 0, e);
            if (top.length > 50) top.pop();
          }
          ns(id).keyRouting = top.map(([key, events]) => ({
            key,
            keyGroup: key === ALL_KEYS ? -1 : keyGroupOf(key),
            subtask: key === ALL_KEYS ? 0 : subtaskOf(key, parallelism),
            events,
          }));
        }
      }
      for (const [id, op] of ops) if (op.keys) ns(id).keys = op.keys();
      return stats;
    },
  };
}
