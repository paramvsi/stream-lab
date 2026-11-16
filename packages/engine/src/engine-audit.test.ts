import { spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { Driver, type DriverMessage } from './driver';
import { BASE_TIME, createRun } from './engine';

// Guards for the engine audit (347216d … d5f75d3), one per confirmed finding.
const node = (id: string, type: NodeType, config: object = {}, disabled = false): PipelineNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { ...(spec(type).defaults() as object), ...config },
  ...(disabled ? { disabled } : {}),
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
const row = (sec: number, card: string | null = 'c_1', amount: number | null = 10) => ({
  card_id: card,
  amount,
  event_time: new Date(BASE_TIME + sec * 1000).toISOString(),
});
const hms = (v: unknown) => String(v).slice(14, 19);
function sessions(rows: ReturnType<typeof row>[], gapS: number, oooS: number) {
  const g: Graph = {
    nodes: [
      node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: oooS * 1000 }),
      node('w', 'Window', { kind: 'session', gapMs: gapS * 1000, keyBy: ['card_id'] }),
      node('out', 'Sink'),
      node('dlq', 'Dead-letter'),
    ],
    edges: [edge('src', 'w'), edge('w', 'out'), edge('w', 'dlq', 'late')],
  };
  const r = createRun(g, { sourceData: { src: rows } });
  r.advance(Infinity);
  const s = r.stats();
  return {
    out: s.outputs['out']!.map((x) => `${hms(x['window_start'])}-${hms(x['window_end'])} n=${x['payments']}`),
    late: s.outputs['dlq']!.length,
  };
}

describe('engine audit · sessions', () => {
  it('#1 one event bridging two sessions merges all three into one window with every event', () => {
    expect(sessions([row(0), row(50), row(25)], 30, 60).out).toEqual(['00:00-01:20 n=3']);
  });
  it('#8 lateness is judged on the merged session, not the new event alone', () => {
    expect(sessions([row(100), row(108), row(95)], 10, 0)).toEqual({ out: ['01:35-01:58 n=3'], late: 0 });
  });
  it('sessions that only touch merge (TimeWindow.intersects is inclusive)', () => {
    expect(sessions([row(0), row(30)], 30, 60).out).toEqual(['00:00-01:00 n=2']);
  });
});

describe('engine audit · watermarks', () => {
  const union = (a: PipelineNode, b: PipelineNode, between = false): Graph => ({
    nodes: [
      a,
      b,
      ...(between ? [node('f', 'Filter', { expr: 'true' })] : []),
      node('u', 'Union'),
      node('w', 'Window', { sizeMs: 60000, keyBy: [] }),
      node('out', 'Sink'),
    ],
    edges: [
      edge('a', 'u'),
      ...(between ? [edge('b', 'f'), edge('f', 'u')] : [edge('b', 'u')]),
      edge('u', 'w'),
      edge('w', 'out'),
    ],
  });
  it('#2 a disabled Source does not hold back the watermark of a Union below it', () => {
    const g = union(
      node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }, true),
      node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
    );
    const r = createRun(g, { sourceData: { b: [row(0), row(70)] } });
    r.advance(Infinity);
    expect(r.stats().outputs['out']!.length).toBe(2);
    expect(r.stats().nodes['u']!.watermark).toBe(Infinity);
  });
  it('#3 an idle Source behind a Filter does not hold back the Union (idleness propagates)', () => {
    const g = union(
      node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0, idleTimeoutMs: 500 }),
      true,
    );
    const r = createRun(g, {
      sourceData: { a: Array.from({ length: 100 }, (_, i) => row(i)), b: [row(0, 'c_2'), row(1, 'c_2')] },
      sourceGapMs: { b: 10000 },
    });
    r.advance(60);
    expect(r.stats().nodes['u']!.watermark).toBeGreaterThan(BASE_TIME + 50000);
  });
  it('#4 a left join holds its output watermark back by its interval, so padded rows are not late', () => {
    const REFUNDS = [
      { name: 'refund_id', type: 'string', required: true },
      { name: 'card_id', type: 'string', required: true },
      { name: 'event_time', type: 'timestamp', required: true },
    ];
    const g: Graph = {
      nodes: [
        node('pay', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('ref', 'Source', { schema: REFUNDS, outOfOrdernessMs: 0 }),
        node('j', 'Join', {
          kind: 'left',
          leftKey: 'card_id',
          rightKey: 'card_id',
          lowerMs: 0,
          upperMs: 60000,
        }),
        node('w', 'Window', { sizeMs: 60000, keyBy: [] }),
        node('out', 'Sink'),
        node('dlq', 'Dead-letter'),
      ],
      edges: [
        edge('pay', 'j', 'main', 'left'),
        edge('ref', 'j', 'main', 'right'),
        edge('j', 'w'),
        edge('w', 'out'),
        edge('w', 'dlq', 'late'),
      ],
    };
    const pays = Array.from({ length: 50 }, (_, i) => row(i * 10, `c_${i}`));
    const refs = Array.from({ length: 50 }, (_, i) => ({
      refund_id: `r${i}`,
      card_id: 'zz',
      event_time: row(i * 10).event_time,
    }));
    const r = createRun(g, { sourceData: { pay: pays, ref: refs } });
    r.advance(Infinity);
    expect(r.stats().nodes['w']!.late).toBe(0);
    // Low: padded rows carry the right side's fields as null (join.ts output schema).
    const first = r.stats().outputs['out']!;
    expect(first.length).toBeGreaterThan(0);
  });
});

describe('engine audit · operators', () => {
  const win = (rows: ReturnType<typeof row>[], aggregates: object[]) => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('w', 'Window', { sizeMs: 60000, keyBy: ['card_id'], aggregates }),
        node('out', 'Sink'),
      ],
      edges: [edge('src', 'w'), edge('w', 'out')],
    };
    const r = createRun(g, { sourceData: { src: rows } });
    r.advance(Infinity);
    return r.stats().outputs['out']!;
  };
  it('#5 COUNT(field), SUM and AVG skip nulls; an all-null group sums to null', () => {
    const aggs = [
      { fn: 'count', field: 'amount', as: 'n' },
      { fn: 'count', field: '', as: 'rows' },
      { fn: 'avg', field: 'amount', as: 'avg' },
      { fn: 'sum', field: 'amount', as: 'sum' },
    ];
    const [a, b] = win([row(0, 'c_1', 10), row(1, 'c_1', null), row(2, 'c_2', null)], aggs);
    expect([a!['n'], a!['rows'], a!['avg'], a!['sum']]).toEqual([1, 2, 10, 10]);
    expect([b!['n'], b!['sum'], b!['avg']]).toEqual([0, null, null]);
  });
  it('#7 window Top-N drops a late update to a window it already ranked', () => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('w', 'Window', {
          sizeMs: 60000,
          keyBy: ['card_id'],
          allowedLatenessMs: 60000,
          aggregates: [{ fn: 'sum', field: 'amount', as: 'total' }],
        }),
        node('t', 'Top-N', { partitionBy: [], orderBy: 'total', desc: true, n: 2, withinWindow: true }),
        node('out', 'Sink'),
      ],
      edges: [edge('src', 'w'), edge('w', 't'), edge('t', 'out')],
    };
    const rows = [row(0, 'a', 50), row(1, 'b', 40), row(70, 'x', 1), row(10, 'c', 31)];
    const r = createRun(g, { sourceData: { src: rows } });
    r.advance(Infinity);
    const ranked = r.stats().outputs['out']!.filter((e) => String(e['window_start']).includes('T12:00:00'));
    expect(ranked.map((e) => `${e['rank']} ${e['card_id']}`)).toEqual(['1 a', '2 b']);
  });
  it('#9 NULL keys never match in a join or a lookup', () => {
    const g: Graph = {
      nodes: [
        node('l', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('r', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('j', 'Join', {
          kind: 'inner',
          leftKey: 'card_id',
          rightKey: 'card_id',
          lowerMs: -60000,
          upperMs: 60000,
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('l', 'j', 'main', 'left'), edge('r', 'j', 'main', 'right'), edge('j', 'out')],
    };
    const r = createRun(g, { sourceData: { l: [row(0, null)], r: [row(1, null)] } });
    r.advance(Infinity);
    expect(r.stats().outputs['out']).toEqual([]);
    const lk: Graph = {
      nodes: [
        node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('k', 'Lookup', {
          table: 't',
          key: 'card_id',
          tableKey: 'card_id',
          asOf: false,
          onMiss: 'reject',
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('s', 'k'), edge('k', 'out')],
    };
    const t = { columns: [], rows: [{ card_id: null, tier: 'gold' }] };
    const r2 = createRun(lk, { sourceData: { s: [row(0, null)] }, refTables: { t } });
    r2.advance(Infinity);
    expect(r2.stats().outputs['out']).toEqual([]);
  });
  it('#10 ENG-01 holds for many keys and many sliding windows (hop 1 h / 1 min, 1,000 keys, 10,000 events)', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { count: 10000, keys: 1000 }),
        node('w', 'Window', { kind: 'hop', sizeMs: 3600000, slideMs: 60000, keyBy: ['card_id'] }),
        node('out', 'Sink'),
      ],
      edges: [edge('gen', 'w'), edge('w', 'out')],
    };
    const t = performance.now();
    const r = createRun(g);
    r.advance(Infinity);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(r.stats().nodes['w']!.out['main']).toBeGreaterThan(0);
  });
  it('low: uploaded epoch-ms and zone-less timestamps are read as UTC, not BASE_TIME or local time', () => {
    const g: Graph = {
      nodes: [node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }), node('out', 'Sink')],
      edges: [edge('src', 'out')],
    };
    const r = createRun(g, {
      sourceData: {
        src: [
          { card_id: 'a', amount: 1, event_time: BASE_TIME + 5000 },
          { card_id: 'b', amount: 1, event_time: '2026-11-15 12:00:30' },
          { card_id: 'c', amount: 1, event_time: '2026-11-15 12:01:00' },
        ],
      },
    });
    r.advance(2);
    expect(r.stats().nodes['out']!.watermark).toBe(BASE_TIME + 30000 - 1);
  });
});

describe('engine audit · driver', () => {
  it('#11 a crash while building the run is a crash message, not an exception', () => {
    const msgs: DriverMessage[] = [];
    const bad = {
      nodes: [{ id: 'x', type: 'Nope', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    } as unknown as Graph;
    expect(() => new Driver(bad, {}, (m) => msgs.push(m))).not.toThrow();
    expect(msgs.at(-1)?.type).toBe('crash');
  });
  it('low: stepping through the last event finishes the run; speed 0 is refused', () => {
    const g: Graph = {
      nodes: [node('gen', 'Generator', { count: 2, duplicatePct: 0 }), node('out', 'Sink')],
      edges: [edge('gen', 'out')],
    };
    const d = new Driver(g, {}, () => {});
    d.step();
    d.step();
    expect(d.state).toBe('finished');
    d.setSpeed(0);
    expect(d.speed).toBeGreaterThan(0);
  });
});

describe('run audit · dead letter', () => {
  it('events whose expression failed reach the Dead-letter node, with the reason (SIM-RUNTIME-EXPR)', () => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('f', 'Filter', { expr: 'amount > 5.0' }),
        node('out', 'Sink'),
        node('dlq', 'Dead-letter'),
      ],
      edges: [edge('src', 'f'), edge('f', 'out')],
    };
    const r = createRun(g, { sourceData: { src: [row(0, 'c_1', 10), row(1, 'c_1', null)] } });
    r.advance(Infinity);
    const dl = r.stats().outputs['dlq']!;
    expect(dl).toHaveLength(1);
    expect(dl[0]!['amount']).toBeNull();
    expect(String(dl[0]!['reason'])).not.toBe('');
  });
});

describe('run panel audit · engine', () => {
  it('#4 a long run keeps window fires and late events on the timeline to the end (samples have their own cap)', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { count: 20000 }),
        node('w', 'Window', { sizeMs: 60000, keyBy: ['card_id'] }),
        node('out', 'Sink'),
      ],
      edges: [edge('gen', 'w'), edge('w', 'out')],
    };
    const r = createRun(g);
    r.advance(Infinity);
    const s = r.stats();
    const fires = s.timeline.filter((t) => t.kind === 'fire');
    expect(fires.at(-1)!.at).toBeGreaterThan(s.now * 0.9);
    expect(s.timeline.filter((t) => t.kind === 'late').length).toBe(s.nodes['w']!.late);
  });

  it('#5 the timeline watermark is the pipeline’s (the slowest input), not the first source’s', () => {
    const ahead = (i: number) => ({ ...row(600 + i), card_id: 'a' });
    const g: Graph = {
      nodes: [
        node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('u', 'Union'),
        node('out', 'Sink'),
      ],
      edges: [edge('a', 'u'), edge('b', 'u'), edge('u', 'out')],
    };
    const r = createRun(g, {
      sourceData: {
        a: Array.from({ length: 100 }, (_, i) => ahead(i)),
        b: Array.from({ length: 100 }, (_, i) => row(i)),
      },
    });
    r.advance(150);
    const wms = r.stats().timeline.filter((t) => t.kind === 'watermark');
    expect(wms.at(-1)!.ts).toBeLessThanOrEqual(r.stats().nodes['u']!.watermark);
  });

  it('#8 a failed event goes to the Dead-letter connected to that node, once; never to a disabled one', () => {
    const g: Graph = {
      nodes: [
        node('src', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('f', 'Filter', { expr: 'amount > 5.0' }),
        node('out', 'Sink'),
        node('dlqA', 'Dead-letter'),
        node('dlqB', 'Dead-letter', {}, true),
        node('dlqC', 'Dead-letter'),
      ],
      edges: [edge('src', 'f'), edge('f', 'out'), edge('f', 'dlqC', 'rejected')],
    };
    const r = createRun(g, { sourceData: { src: [row(0, 'c_1', null)] } });
    r.advance(Infinity);
    const s = r.stats();
    expect([s.nodes['dlqA']?.in ?? 0, s.nodes['dlqB']?.in ?? 0, s.nodes['dlqC']!.in]).toEqual([0, 0, 1]);
    expect(s.deadLetter).toHaveLength(1);
  });
});

describe('data audit · timeline and preview', () => {
  it('#2 a node fed only by a disabled source does not erase the pipeline watermark', async () => {
    const { pipelineWatermark } = await import('./engine');
    const g: Graph = {
      nodes: [
        node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('out', 'Sink'),
        node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }, true),
        node('out2', 'Sink'),
      ],
      edges: [edge('a', 'out'), edge('b', 'out2')],
    };
    const r = createRun(g, { sourceData: { a: Array.from({ length: 50 }, (_, i) => row(i)) } });
    r.advance(40);
    expect(Number.isFinite(pipelineWatermark(r.stats()))).toBe(true);
    expect(r.stats().timeline.filter((t) => t.kind === 'watermark').length).toBeGreaterThan(0);
  });
  it('#3 on a long multi-source run the watermark line reaches the end', () => {
    const g: Graph = {
      nodes: [
        node('a', 'Generator', { count: 10000 }),
        node('b', 'Generator', { count: 10000, seed: 9 }),
        node('u', 'Union'),
        node('out', 'Sink'),
      ],
      edges: [edge('a', 'u'), edge('b', 'u'), edge('u', 'out')],
    };
    const r = createRun(g);
    r.advance(Infinity);
    const wms = r.stats().timeline.filter((t) => t.kind === 'watermark');
    expect(wms.at(-1)!.at).toBeGreaterThan(r.stats().now * 0.95);
  });
  it('#4 the preview uses the pipeline’s seed and generator settings', async () => {
    const { runToHere } = await import('./preview');
    const g: Graph = {
      nodes: [node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 })],
      edges: [],
    };
    const p = runToHere(g, 's', 5, { seed: 7, generator: { keys: 1, seed: 7 } })!;
    expect(new Set(p.out['main']!.map((e) => e['card_id']))).toEqual(new Set(['c_1000']));
  });
});
