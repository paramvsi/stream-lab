import { spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { BASE_TIME, createRun } from './engine';
import { keyGroupOf, subtaskOf } from './keygroups';

const node = (id: string, type: NodeType, config: object = {}): PipelineNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { ...(spec(type).defaults() as object), ...config },
});
const edge = (s: string, t: string, sh = 'main', th = 'main'): PipelineEdge => ({
  id: `${s}-${sh}-${t}-${th}`,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
});
const SCHEMA = [
  { name: 'card_id', type: 'string', required: true },
  { name: 'amount', type: 'number', required: true },
  { name: 'event_time', type: 'timestamp', required: true },
];
const row = (sec: number, card = 'c_1', amount = 10) => ({
  card_id: card,
  amount,
  event_time: new Date(BASE_TIME + sec * 1000).toISOString(),
});
/** Source (explicit rows, out-of-orderness 0) → Window → Sink, late → Dead-letter. */
function windowed(rows: ReturnType<typeof row>[], window: object = {}) {
  const g: Graph = {
    nodes: [
      node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('w', 'Window', {
        kind: 'tumble',
        sizeMs: 60000,
        keyBy: ['card_id'],
        allowedLatenessMs: 0,
        ...window,
      }),
      node('out', 'Sink'),
      node('dlq', 'Dead-letter'),
    ],
    edges: [edge('src', 'w'), edge('w', 'out'), edge('w', 'dlq', 'late')],
  };
  const run = createRun(g, { sourceData: { src: rows } });
  run.advance(Infinity);
  return run.stats();
}
const counts = (s: ReturnType<typeof windowed>) =>
  s.outputs['out']!.map((r) => `${String(r['window_start']).slice(11, 19)} ${r['payments']}`);

describe('ENG-02 · event time (Flink semantics)', () => {
  it('watermark = max event time − out-of-orderness − 1 (BoundedOutOfOrdernessWatermarks)', () => {
    const g: Graph = {
      nodes: [node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 5000 }), node('out', 'Sink')],
      edges: [edge('src', 'out')],
    };
    const run = createRun(g, { sourceData: { src: [row(30), row(10), row(40)] } });
    run.advance(2);
    expect(run.stats().nodes['out']!.watermark).toBe(BASE_TIME + 30000 - 5000 - 1);
  });

  it('a tumbling window fires when the watermark passes end − 1; the result carries end − 1', () => {
    const s = windowed([row(0), row(10), row(70)]);
    expect(counts(s)).toEqual(['12:00:00 2', '12:01:00 1']);
    expect(s.timeline.filter((t) => t.kind === 'fire')[0]!.ts).toBe(BASE_TIME + 59999);
  });

  it('an event for a window already closed goes to the late side output (sideOutputLateData)', () => {
    const s = windowed([row(0), row(70), row(30)]);
    expect(counts(s)).toEqual(['12:00:00 1', '12:01:00 1']);
    expect(s.outputs['dlq']).toEqual([{ ...row(30), reason: 'late' }]);
    expect(s.nodes['w']!.late).toBe(1);
  });

  it('boundary: a watermark exactly at end − 1 closes the window (maxTimestamp + lateness <= watermark)', () => {
    // row(60) sets the watermark to 12:00:59.999 = end − 1 of the first window.
    const s = windowed([row(0), row(60), row(30)]);
    expect(counts(s)).toEqual(['12:00:00 1', '12:01:00 1']);
    expect(s.outputs['dlq']!.map((r) => r['event_time'])).toEqual([row(30).event_time]);
  });

  it('allowed lateness keeps the window: a late-but-allowed event re-fires it with the update', () => {
    const s = windowed([row(0), row(70), row(30), row(100), row(5)], { allowedLatenessMs: 20000 });
    expect(counts(s)).toEqual(['12:00:00 1', '12:00:00 2', '12:01:00 2']);
    // At 12:01:40 the watermark passed 12:00:59.999 + 20 s: the window is gone, row(5) is late.
    expect(s.outputs['dlq']!.map((r) => r['event_time'])).toEqual([row(5).event_time]);
  });

  it('sliding windows assign each event to size/slide windows', () => {
    const s = windowed([row(15)], { kind: 'hop', sizeMs: 60000, slideMs: 20000 });
    expect(s.outputs['out']!.map((r) => String(r['window_start']).slice(11, 19))).toEqual([
      '11:59:20',
      '11:59:40',
      '12:00:00',
    ]);
  });

  it('session windows merge events closer than the gap', () => {
    const s = windowed([row(0), row(20), row(100)], { kind: 'session', gapMs: 30000 });
    expect(counts(s)).toEqual(['12:00:00 2', '12:01:40 1']);
  });
});

describe('ENG-03 · keyed state and subtasks', () => {
  it('counts each keyed event on the subtask Flink would pick', () => {
    const rows = [row(0, 'c_4471'), row(1, 'c_7710'), row(2, 'c_4471')];
    const s = windowed(rows);
    // Golden (keygroups.test.ts): c_4471 → subtask 1 of 2, c_7710 → 0.
    expect([subtaskOf('c_4471', 2), subtaskOf('c_7710', 2)]).toEqual([1, 0]);
    expect(s.nodes['w']!.subtasks).toEqual([1, 2]);
  });
});

const fraud = (seed = 42, count = 1000): Graph => ({
  nodes: [
    node('gen', 'Generator', { seed, count }),
    node('val', 'Validate'),
    node('win', 'Window', { sizeMs: 300000, keyBy: ['card_id'] }),
    node('flt', 'Filter', { expr: 'payments > 3' }),
    node('out', 'Sink'),
    node('dlq', 'Dead-letter'),
  ],
  edges: [
    edge('gen', 'val'),
    edge('val', 'win'),
    edge('win', 'flt'),
    edge('flt', 'out'),
    edge('val', 'dlq', 'rejected'),
    edge('win', 'dlq', 'late'),
  ],
});

describe('SIM-24 · deterministic', () => {
  it('the same seed and pipeline give identical output (snapshot)', () => {
    const a = createRun(fraud());
    a.advance(Infinity);
    const b = createRun(fraud());
    b.advance(Infinity);
    expect(a.stats()).toEqual(b.stats());
    expect({ out: a.stats().outputs['out']!.slice(0, 5), counts: a.stats().nodes }).toMatchSnapshot();
    const c = createRun(fraud(43));
    c.advance(Infinity);
    expect(c.stats().outputs['out']).not.toEqual(a.stats().outputs['out']);
  });
});

describe('SIM-18 · runtime expression failures', () => {
  it('go to the dead letter and are counted on the node (bad rows have no amount)', () => {
    const run = createRun(fraud(42, 2000));
    run.advance(Infinity);
    const s = run.stats();
    expect(s.nodes['val']!.failed).toBeGreaterThan(0);
    expect(s.deadLetter.every((d) => d.node === 'val' && d.data['amount'] === null)).toBe(true);
    expect(s.deadLetter).toHaveLength(s.nodes['val']!.failed);
  });
});

describe('ENG-01 · performance', () => {
  it('10,000 events replay in under 2 s', () => {
    const t = performance.now();
    const run = createRun(fraud(42, 10000));
    run.advance(Infinity);
    const ms = performance.now() - t;
    expect(run.stats().processed).toBeGreaterThanOrEqual(10000);
    expect(ms).toBeLessThan(2000);
  });
});

describe('ENG-02 · idleness', () => {
  // A: busy (every 20 ms). B: one row, then nothing for 10 s of simulation clock, then one more.
  const g = (idleTimeoutMs: number): Graph => ({
    nodes: [
      node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0, idleTimeoutMs }),
      node('u', 'Union'),
      node('out', 'Sink'),
    ],
    edges: [edge('a', 'u'), edge('b', 'u'), edge('u', 'out')],
  });
  const data = {
    a: Array.from({ length: 100 }, (_, i) => row(i)),
    b: [row(0, 'c_2'), row(1, 'c_2')],
  };
  it('an idle input does not hold back the watermark (withIdleness)', () => {
    const held = createRun(g(0), { sourceData: data, sourceGapMs: { b: 10000 } });
    held.advance(60); // 1.2 s of clock: B has not sent its second row
    expect(held.stats().nodes['u']!.watermark).toBe(BASE_TIME - 1); // held by B at its first row
    const idle = createRun(g(500), { sourceData: data, sourceGapMs: { b: 10000 } });
    idle.advance(60);
    expect(idle.stats().nodes['u']!.watermark).toBeGreaterThan(BASE_TIME + 50000);
  });
});

describe('Engine operators', () => {
  const REFUNDS = [
    { name: 'refund_id', type: 'string', required: true },
    { name: 'card_id', type: 'string', required: true },
    { name: 'event_time', type: 'timestamp', required: true },
  ];
  const refund = (sec: number, card: string, id: string) => ({
    refund_id: id,
    card_id: card,
    event_time: new Date(BASE_TIME + sec * 1000).toISOString(),
  });
  const joinGraph = (kind: 'inner' | 'left'): Graph => ({
    nodes: [
      node('pay', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('ref', 'Source', { schema: REFUNDS, outOfOrdernessMs: 0 }),
      node('j', 'Join', { kind, leftKey: 'card_id', rightKey: 'card_id', lowerMs: 0, upperMs: 60000 }),
      node('out', 'Sink'),
    ],
    edges: [edge('pay', 'j', 'main', 'left'), edge('ref', 'j', 'main', 'right'), edge('j', 'out')],
  });
  const joinData = {
    pay: [row(0, 'c_1'), row(0, 'c_2'), row(0, 'c_3')],
    ref: [refund(30, 'c_1', 'r1'), refund(90, 'c_2', 'r2')],
  };

  it('interval join matches r within [l + lower, l + upper]; left join emits misses when they can no longer match', () => {
    const inner = createRun(joinGraph('inner'), { sourceData: joinData });
    inner.advance(Infinity);
    expect(inner.stats().outputs['out']!.map((r) => [r['card_id'], r['refund_id']])).toEqual([['c_1', 'r1']]);
    const left = createRun(joinGraph('left'), { sourceData: joinData });
    left.advance(Infinity);
    expect(
      left
        .stats()
        .outputs['out']!.map((r) => [r['card_id'], r['refund_id'] ?? null])
        .sort(),
    ).toEqual([
      ['c_1', 'r1'],
      ['c_2', null],
      ['c_3', null],
    ]);
  });

  it('Deduplicate keeps the first per key until the TTL passes on the simulation clock', () => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('d', 'Deduplicate', { key: ['card_id'], keep: 'first', ttlMs: 100 }),
        node('out', 'Sink'),
      ],
      edges: [edge('src', 'd'), edge('d', 'out')],
    };
    // Arrivals every 40 ms: rows 0,1,2 (0–80 ms) dedup; row 3 at 120 ms is past the 100 ms TTL.
    const run = createRun(g, {
      sourceData: { src: [0, 1, 2, 3].map((i) => row(i, 'c_1', i)) },
      sourceGapMs: { src: 40 },
    });
    run.advance(Infinity);
    expect(run.stats().outputs['out']!.map((r) => r['amount'])).toEqual([0, 3]);
  });

  it('window Top-N ranks per window and emits when the window closes', () => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('w', 'Window', {
          sizeMs: 60000,
          keyBy: ['card_id'],
          aggregates: [{ fn: 'sum', field: 'amount', as: 'total' }],
        }),
        node('t', 'Top-N', { partitionBy: [], orderBy: 'total', desc: true, n: 2, withinWindow: true }),
        node('out', 'Sink'),
      ],
      edges: [edge('src', 'w'), edge('w', 't'), edge('t', 'out')],
    };
    const rows = [row(0, 'a', 5), row(1, 'b', 50), row(2, 'c', 20), row(3, 'b', 1), row(70, 'a', 1)];
    const run = createRun(g, { sourceData: { src: rows } });
    run.advance(Infinity);
    expect(run.stats().outputs['out']!.map((r) => `${r['rank']} ${r['card_id']} ${r['total']}`)).toEqual([
      '1 b 51',
      '2 c 20',
      '1 a 1',
    ]);
  });

  it('a versioned lookup picks the row valid at event time (temporal join)', () => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('l', 'Lookup', {
          table: 'fx',
          key: 'card_id',
          tableKey: 'card_id',
          asOf: true,
          onMiss: 'reject',
        }),
        node('out', 'Sink'),
        node('dlq', 'Dead-letter'),
      ],
      edges: [edge('src', 'l'), edge('l', 'out'), edge('l', 'dlq', 'rejected')],
    };
    const fx = {
      versioned: true,
      columns: [],
      rows: [
        { card_id: 'c_1', rate: 1, valid_from: new Date(BASE_TIME).toISOString() },
        { card_id: 'c_1', rate: 2, valid_from: new Date(BASE_TIME + 60000).toISOString() },
      ],
    };
    const run = createRun(g, { sourceData: { src: [row(30), row(90), row(10, 'c_9')] }, refTables: { fx } });
    run.advance(Infinity);
    expect(run.stats().outputs['out']!.map((r) => r['rate'])).toEqual([1, 2]);
    expect(run.stats().outputs['dlq']!.map((r) => [r['card_id'], r['reason']])).toEqual([
      ['c_9', 'no match'],
    ]);
  });
});

describe('SIM-21 · timeline samples', () => {
  it('logs sampled arrivals and source watermarks next to window fires and late events', () => {
    const run = createRun(fraud(42, 2000));
    run.advance(Infinity);
    const kinds = new Set(run.stats().timeline.map((t) => t.kind));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['event', 'fire', 'late', 'watermark']));
    const wms = run
      .stats()
      .timeline.filter((t) => t.kind === 'watermark')
      .map((t) => t.ts);
    expect(wms).toEqual([...wms].sort((a, b) => a - b)); // watermarks never go back
  });
});

describe('SIM-16 · Chaos', () => {
  it('injects late, duplicate and malformed events now, and stalls one source', () => {
    const plain = createRun(fraud(42, 2000));
    plain.advance(Infinity);
    const r = createRun(fraud(42, 2000));
    r.advance(1000);
    const before = r.stats().total;
    const rep = r.inject({ late: 5, duplicates: 5, malformed: 5, stallMs: 3000 });
    expect(rep).toEqual({ late: 5, duplicates: 5, malformed: 5, stalled: 'gen', stallMs: 3000 });
    expect(r.stats().total).toBe(before + 15);
    const at = r.stats().now;
    expect(r.next()).toBe(at); // injected events arrive now
    r.advance(15);
    expect(r.next()!).toBeGreaterThanOrEqual(at + 3000); // then the source is silent for 3 s
    r.advance(Infinity);
    const s = r.stats();
    const p = plain.stats();
    expect(s.nodes['val']!.failed).toBe(p.nodes['val']!.failed + 5); // malformed rows fail the rule
    expect(s.nodes['win']!.late).toBeGreaterThanOrEqual(p.nodes['win']!.late + 5); // a minute behind: late
    expect(s.processed).toBe(p.processed + 15);
  });
});

describe('ENG-03 · stage inspector data', () => {
  it('lists the busiest keys of a keyed node with the key group and subtask Flink would use', () => {
    const r = createRun(fraud(42, 2000), { parallelism: 4 });
    r.advance(Infinity);
    const k = r.stats().nodes['win']!.keyRouting!;
    expect(k.length).toBeGreaterThan(0);
    expect(k.length).toBeLessThanOrEqual(50);
    for (const x of k) {
      expect(x.keyGroup).toBe(keyGroupOf(x.key));
      expect(x.subtask).toBe(subtaskOf(x.key, 4));
    }
    expect(k.reduce((a, x) => a + x.events, 0)).toBe(
      r.stats().nodes['win']!.subtasks!.reduce((a, b) => a + b, 0),
    );
    expect([...k].sort((a, b) => b.events - a.events)).toEqual(k);
  });
});
