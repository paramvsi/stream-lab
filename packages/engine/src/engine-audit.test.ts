import { PAYMENTS, spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { Driver, type DriverMessage } from './driver';
import { BASE_TIME, createRun, generate } from './engine';
import { BUILTIN_TABLES } from './fintech';

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

describe('chaos audit', () => {
  const twoSources = (): Graph => ({
    nodes: [
      node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('u', 'Union'),
      node('w', 'Window', { sizeMs: 60000, keyBy: [] }),
      node('out', 'Sink'),
      node('dlq', 'Dead-letter'),
    ],
    edges: [edge('a', 'u'), edge('b', 'u'), edge('u', 'w'), edge('w', 'out'), edge('w', 'dlq', 'late')],
  });
  const data = () => ({
    a: Array.from({ length: 200 }, (_, i) => row(i)),
    b: Array.from({ length: 200 }, (_, i) => row(i, 'c_2')),
  });

  it('#1 chaos right after the first event never stalls window firing (no -Infinity timestamps)', () => {
    const plain = createRun(twoSources(), { sourceData: data() });
    plain.advance(Infinity);
    const r = createRun(twoSources(), { sourceData: data() });
    r.advance(1);
    const rep = r.inject();
    r.advance(Infinity);
    expect(r.stats().outputs['out']!.length).toBeGreaterThanOrEqual(plain.stats().outputs['out']!.length);
    expect(rep.late).toBe(0); // one input has not started: no watermark to be behind, so none injected
  });

  it('#2 duplicates and malformed rows do not push the watermark ahead (no extra late events)', () => {
    const g: Graph = {
      nodes: [
        node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('w', 'Window', { sizeMs: 60000, keyBy: [] }),
        node('out', 'Sink'),
        node('dlq', 'Dead-letter'),
      ],
      edges: [edge('s', 'w'), edge('w', 'out'), edge('w', 'dlq', 'late')],
    };
    const rows = Array.from({ length: 200 }, (_, i) => row(i)); // 1 event per second of event time
    const r = createRun(g, { sourceData: { s: rows } });
    r.advance(55); // just before the first window's end (60 s): a watermark pushed ahead would close it early
    const rep = r.inject({ late: 0, duplicates: 5, malformed: 5, stallMs: 0 });
    r.advance(Infinity);
    expect(rep.late).toBe(0);
    expect(r.stats().nodes['w']!.late).toBe(0);
  });

  it('#6 late copies carry their new event time; malformed counts only rows really broken', () => {
    const OPT = SCHEMA.map((f) => ({ ...f, required: f.name === 'event_time' }));
    const g: Graph = {
      nodes: [node('s', 'Source', { schema: OPT, outOfOrdernessMs: 0 }), node('out', 'Sink')],
      edges: [edge('s', 'out')],
    };
    const r = createRun(g, { sourceData: { s: Array.from({ length: 100 }, (_, i) => row(i)) } });
    r.advance(80);
    const rep = r.inject({ late: 1, duplicates: 0, malformed: 3, stallMs: 0 });
    expect(rep.malformed).toBe(0); // no required number to null
    r.advance(1);
    const late = r.stats().outputs['out']!.at(-1)!;
    expect(Date.parse(String(late['event_time']))).toBeLessThan(BASE_TIME + 79_000 - 30_000);
  });
});

describe('storage audit · chaos', () => {
  const g = (): Graph => ({
    nodes: [
      node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('w', 'Window', { sizeMs: 60000, keyBy: [] }),
      node('out', 'Sink'),
      node('dlq', 'Dead-letter'),
      node('out2', 'Sink'),
    ],
    edges: [edge('a', 'w'), edge('w', 'out'), edge('w', 'dlq', 'late'), edge('b', 'out2')],
  });
  it('#3 a second Chaos copies real events, not the first Chaos copies', () => {
    const rows = Array.from({ length: 400 }, (_, i) => row(i / 4));
    const r = createRun(g(), { sourceData: { a: rows, b: rows.map((x) => ({ ...x, card_id: 'c_2' })) } });
    r.advance(300);
    r.inject({ late: 0, duplicates: 0, malformed: 5, stallMs: 0 });
    r.advance(5); // exactly the 5 malformed copies: they are now the most recent events
    r.inject({ late: 0, duplicates: 5, malformed: 0, stallMs: 0 });
    r.advance(Infinity);
    const nulls = r
      .stats()
      .outputs['out2']!.concat(r.stats().outputs['dlq']!)
      .filter((e) => e['amount'] === null);
    expect(nulls.length).toBeLessThanOrEqual(5); // only the 5 malformed rows, never copies of them
  });
  it('#4 copies only from sources that still have events (a finished source has passed its final watermark)', () => {
    const r = createRun(g(), {
      sourceData: {
        a: Array.from({ length: 50 }, (_, i) => row(i)),
        b: Array.from({ length: 50 }, (_, i) => row(i)),
      },
      sourceGapMs: { b: 1000 },
    });
    r.advance(51); // a has finished (its 50 events are the most recent), b has sent one of its 50
    r.inject({ late: 0, duplicates: 5, malformed: 0, stallMs: 0 });
    r.advance(Infinity);
    expect(r.stats().nodes['w']!.late).toBe(0);
  });
});

describe('inspector audit', () => {
  it('#7 a window with no key runs on one subtask; a NULL join key shows as ∅, apart from the text "null"', () => {
    const g: Graph = {
      nodes: [
        node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('w', 'Window', { sizeMs: 60000, keyBy: [] }),
        node('out', 'Sink'),
      ],
      edges: [edge('s', 'w'), edge('w', 'out')],
    };
    const r = createRun(g, { sourceData: { s: Array.from({ length: 20 }, (_, i) => row(i, `c_${i}`)) } });
    r.advance(Infinity);
    expect(r.stats().nodes['w']!.subtasks!.filter((x) => x > 0)).toHaveLength(1);
    const j: Graph = {
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
    const rj = createRun(j, { sourceData: { l: [row(0, null), row(1, 'null')], r: [row(2, 'c_9')] } });
    rj.advance(Infinity);
    const keys = rj
      .stats()
      .nodes['j']!.keyRouting!.map((k) => k.key)
      .sort();
    expect(keys).toEqual(['c_9', 'null', '∅']);
  });
  it('#8 only the 50 busiest keys are listed (the cut-off is exercised)', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { count: 600 }),
        node('d', 'Deduplicate', { key: ['payment_id'] }),
        node('out', 'Sink'),
      ],
      edges: [edge('gen', 'd'), edge('d', 'out')],
    };
    const r = createRun(g);
    r.advance(Infinity);
    const k = r.stats().nodes['d']!.keyRouting!;
    expect(k).toHaveLength(50);
    expect(k.reduce((a, x) => a + x.events, 0)).toBeLessThan(
      r.stats().nodes['d']!.subtasks!.reduce((a, b) => a + b, 0),
    );
  });
});

describe('routing audit', () => {
  const g: Graph = {
    nodes: [
      node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('w', 'Window', { sizeMs: 3600000, keyBy: ['card_id'] }),
      node('out', 'Sink'),
    ],
    edges: [edge('s', 'w'), edge('w', 'out')],
  };
  // k_01 … k_60, key k_i with i events: the 50 busiest are k_11 … k_60.
  const rows = Array.from({ length: 60 }, (_, i) => i + 1).flatMap((n) =>
    Array.from({ length: n }, () => row(0, `k_${String(n).padStart(2, '0')}`)),
  );
  it('#1 the busiest keys are current after every step and on pause (not every 10th call only)', () => {
    const r = createRun(g, { sourceData: { s: rows } });
    for (let k = 1; k <= 7; k++) {
      r.step();
      const st = r.stats().nodes['w']!;
      expect(st.keyRouting!.reduce((a, x) => a + x.events, 0)).toBe(st.subtasks!.reduce((a, b) => a + b, 0));
    }
  });
  it('#2 the top 50 are the 50 busiest keys, ties broken by key', () => {
    const r = createRun(g, { sourceData: { s: [...rows].reverse() } });
    r.advance(Infinity);
    const keys = r.stats().nodes['w']!.keyRouting!.map((k) => k.key);
    expect(keys).toHaveLength(50);
    expect(new Set(keys)).toEqual(new Set(Array.from({ length: 50 }, (_, i) => `k_${i + 11}`)));
  });
  it('#2 ties: with equal counts the first 50 keys win, whatever order they arrived in', () => {
    const ties = Array.from({ length: 60 }, (_, i) => row(0, `t_${String(59 - i).padStart(2, '0')}`));
    const r = createRun(g, { sourceData: { s: ties } });
    r.advance(Infinity);
    const keys = r.stats().nodes['w']!.keyRouting!.map((k) => k.key);
    expect(keys).toEqual(Array.from({ length: 50 }, (_, i) => `t_${String(i).padStart(2, '0')}`));
  });
});

describe('DATA-03 audit: the run keeps a built-in table over an imported one of the same name', () => {
  it('createRun merges with the built-in winning', () => {
    const g: Graph = {
      nodes: [
        node('s', 'Generator', {}),
        node('l', 'Lookup', {
          table: 'merchants',
          key: 'merchant_id',
          tableKey: 'merchant_id',
          asOf: false,
          onMiss: 'pass',
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('s', 'l'), edge('l', 'out')],
    };
    const r = createRun(g, {
      refTables: {
        merchants: { columns: [{ name: 'merchant_id', type: 'string', required: true }], rows: [] },
      },
    });
    r.advance(Infinity);
    expect(Object.keys(r.stats().outputs['out']![0]!)).toContain('risk_tier');
  });
});

describe('DATA-05 generator: key skew and fraud patterns', () => {
  const base = {
    rate: 50,
    count: 2000,
    keys: 400,
    latePct: 0,
    outOfOrderPct: 0,
    duplicatePct: 0,
    badRowsPct: 0,
    seed: 7,
  };
  const cards = (evs: { ev: { data: Record<string, unknown> } }[]) =>
    evs.map((e) => String(e.ev.data['card_id']));
  it('skew: the top 1% of cards get about the share asked for', () => {
    const evs = generate(PAYMENTS, { ...base, skewPct: 30 });
    const top = new Set(Array.from({ length: 4 }, (_, i) => `c_${1000 + i}`));
    const share = cards(evs).filter((c) => top.has(c)).length / evs.length;
    expect(share).toBeGreaterThan(0.27);
    expect(share).toBeLessThan(0.34);
  });
  it('no skew and no patterns: the same events as before these settings existed (values from 36f645d^)', () => {
    const evs = generate(PAYMENTS, {
      ...base,
      latePct: 5,
      outOfOrderPct: 10,
      duplicatePct: 2,
      badRowsPct: 1,
      skewPct: 0,
      patterns: { burst: false, blocklisted: false },
    });
    expect({
      n: evs.length,
      cards: evs.slice(0, 8).map((e) => e.ev.data['card_id']),
      last: evs.at(-1)!.ev.data,
      ts: evs.slice(0, 5).map((e) => e.ev.ts),
    }).toEqual({
      n: 2035,
      cards: ['c_1390', 'c_1103', 'c_1118', 'c_1219', 'c_1249', 'c_1307', 'c_1142', 'c_1017'],
      last: {
        amount: 94.77,
        card_id: 'c_1119',
        currency: 'EUR',
        event_time: '2026-11-15T12:00:39.980Z',
        merchant_id: 'm_107',
        payment_id: 'p_101999',
        status: 'declined',
      },
      ts: [1794743990283, 1794744000020, 1794744000040, 1794744000060, 1794744000080],
    });
  });
  it('audit: with duplicates and bad rows, patterns keep copies identical and bad rows bad', () => {
    const chaos = { ...base, duplicatePct: 10, badRowsPct: 10 };
    const on = generate(PAYMENTS, { ...chaos, patterns: { burst: true, blocklisted: true } });
    const off = generate(PAYMENTS, chaos);
    const byId = new Map<string, string[]>();
    for (const e of on) {
      const id = String(e.ev.data['payment_id']);
      byId.set(id, [...(byId.get(id) ?? []), JSON.stringify(e.ev.data)]);
    }
    expect([...byId.values()].filter((v) => new Set(v).size > 1)).toEqual([]); // no copy diverges
    const bad = (evs: typeof on) => evs.filter((e) => e.ev.data['amount'] === null).length;
    expect(bad(on)).toBe(bad(off)); // the malformed rows promised stay malformed
    // The burst is 8 payments in a row (by payment, not by position): p_100600 … p_100607.
    const burst = Array.from({ length: 8 }, (_, k) => `p_${100600 + k}`);
    expect(burst.map((id) => JSON.parse(byId.get(id)![0]!).card_id)).toEqual(Array(8).fill('c_1399'));
    // Every 25th payment (12, 37, …) goes to a blocklisted merchant.
    const listed = new Set(['m_103', 'm_107', 'm_110']);
    for (const k of [12, 37, 62, 987])
      expect(listed.has(JSON.parse(byId.get(`p_${100000 + k}`)![0]!).merchant_id)).toBe(true);
  });
  it('audit: no burst in a run too short for 8 payments (as before)', () => {
    const evs = generate(PAYMENTS, { ...base, count: 5, patterns: { burst: true, blocklisted: false } });
    expect(evs.map((e) => e.ev.data['card_id'])).not.toContain('c_1399');
  });
  it('burst: one card makes 8 small payments in a row', () => {
    const evs = generate(PAYMENTS, { ...base, patterns: { burst: true, blocklisted: false } });
    const runs = evs.map((e, i) => evs.slice(i, i + 8)).filter((w) => w.length === 8);
    const burst = runs.find(
      (w) => new Set(cards(w)).size === 1 && w.every((e) => Number(e.ev.data['amount']) < 10),
    );
    expect(burst).toBeDefined();
  });
  it('blocklisted: some payments go to merchants on the built-in blocklist', () => {
    const listed = new Set(BUILTIN_TABLES['blocklist']!.rows.map((r) => r['merchant_id']));
    const off = generate(PAYMENTS, base).filter((e) => listed.has(e.ev.data['merchant_id'] as string)).length;
    const on = generate(PAYMENTS, { ...base, patterns: { burst: false, blocklisted: true } }).filter((e) =>
      listed.has(e.ev.data['merchant_id'] as string),
    ).length;
    expect(on).toBeGreaterThan(off + 20);
  });
});

describe('EXPL-02 lineage (explain mode only)', () => {
  const g: Graph = {
    nodes: [
      node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
      node('f', 'Filter', { expr: 'amount > 1.0' }),
      node('w', 'Window', {
        sizeMs: 60000,
        keyBy: ['card_id'],
        aggregates: [{ fn: 'count', field: '', as: 'n' }],
      }),
      node('out', 'Sink'),
    ],
    edges: [edge('s', 'f'), edge('f', 'w'), edge('w', 'out')],
  };
  const rows = [row(0, 'c1', 5), row(10, 'c1', 0.5), row(20, 'c1', 7), row(30, 'c2', 9)];
  it('tracing does not change the run', () => {
    const plain = createRun(g, { sourceData: { s: rows } });
    const traced = createRun(g, { sourceData: { s: rows }, trace: true });
    plain.advance(Infinity);
    traced.advance(Infinity);
    expect(traced.stats().outputs).toEqual(plain.stats().outputs);
  });
  it('an output row leads back through the window to the filtered source events', () => {
    const r = createRun(g, { sourceData: { s: rows }, trace: true });
    r.advance(Infinity);
    const t = r.trace()!;
    const c1 = t.outputs['out']!.findIndex((id) => t.hops.get(id)!.data['card_id'] === 'c1');
    const win = t.hops.get(t.outputs['out']![c1]!)!; // the row is the window's output
    expect(win.node).toBe('w');
    expect(win.parents).toHaveLength(2); // 5 and 7; 0.5 was filtered out
    const passed = win.parents.map((p) => t.hops.get(p)!);
    expect(passed.map((h) => h.node)).toEqual(['f', 'f']);
    expect(passed.map((h) => t.hops.get(h.parents[0]!)!.node)).toEqual(['s', 's']);
    expect(passed.map((h) => h.data['amount'])).toEqual([5, 7]);
  });
  it('a join result has both sides as parents', () => {
    const j: Graph = {
      nodes: [
        node('a', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('b', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('j', 'Join', {
          kind: 'inner',
          leftKey: 'card_id',
          rightKey: 'card_id',
          lowerMs: -60000,
          upperMs: 60000,
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('a', 'j', 'main', 'left'), edge('b', 'j', 'main', 'right'), edge('j', 'out')],
    };
    const r = createRun(j, { sourceData: { a: [row(0, 'c1', 5)], b: [row(10, 'c1', 7)] }, trace: true });
    r.advance(Infinity);
    const t = r.trace()!;
    const hop = t.hops.get(t.outputs['out']![0]!)!;
    expect(hop.parents.map((p) => t.hops.get(p)!.node).sort()).toEqual(['a', 'b']);
  });
  it('no trace unless asked', () => {
    const r = createRun(g, { sourceData: { s: rows } });
    r.advance(Infinity);
    expect(r.trace()).toBeNull();
  });
});
