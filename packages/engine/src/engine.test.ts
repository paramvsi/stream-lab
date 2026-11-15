import { spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { BASE_TIME, createRun } from './engine';
import { subtaskOf } from './keygroups';

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
