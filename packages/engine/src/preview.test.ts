import { spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { runToHere, sampleEvents } from './preview';

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

describe('NODE-04 · sample events', () => {
  it('are deterministic for a seed and typed by the schema', () => {
    const g: Graph = { nodes: [node('gen', 'Generator')], edges: [] };
    const a = runToHere(g, 'gen')!.run.out['main']!;
    expect(a).toHaveLength(5);
    expect(runToHere(g, 'gen')!.run.out['main']).toEqual(a);
    expect(typeof a[0]!['amount']).toBe('number');
    expect(['AED', 'USD', 'EUR']).toContain(a[0]!['currency']);
    expect(
      sampleEvents([{ name: 'event_time', type: 'timestamp', required: true }], 1)[0]!['event_time'],
    ).toMatch(/^2026-/);
  });
});

describe('NODE-04/05 · run to here', () => {
  it('Filter splits the input on the expression; rejected gets the rest', () => {
    const g: Graph = {
      nodes: [node('gen', 'Generator'), node('f', 'Filter', { expr: 'amount > 1000.0' })],
      edges: [edge('gen', 'f')],
    };
    const p = runToHere(g, 'f', 20)!;
    const kept = p.run.out['main']!;
    expect(p.input['main']).toHaveLength(20);
    expect(kept.every((e) => (e['amount'] as number) > 1000)).toBe(true);
    expect(kept.length + p.run.out['rejected']!.length).toBe(20);
    expect(p.run.failed).toBe(0);
  });

  it('Map adds a computed field; Window keeps state per key', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator'),
        node('m', 'Map', { assignments: [{ field: 'amount_x2', expr: 'amount * 2.0' }] }),
        node('w', 'Window', { sizeMs: 3600000, keyBy: ['card_id'] }),
      ],
      edges: [edge('gen', 'm'), edge('m', 'w')],
    };
    const m = runToHere(g, 'm')!;
    const e0 = m.run.out['main']![0]!;
    expect(e0['amount_x2']).toBeCloseTo((e0['amount'] as number) * 2);
    const w = runToHere(g, 'w', 12)!;
    expect(w.run.state!.length).toBeGreaterThan(0);
    expect(w.run.state!.map((s) => s.key).every((k) => /^c_\d+ · \d\d:\d\d$/.test(k))).toBe(true);
  });

  it('a bad expression counts failures instead of throwing', () => {
    const g: Graph = {
      nodes: [node('gen', 'Generator'), node('f', 'Filter', { expr: 'nope > 1' })],
      edges: [edge('gen', 'f')],
    };
    expect(runToHere(g, 'f')!.run.failed).toBe(5);
  });

  it('only ancestors run; an unknown node gives null', () => {
    expect(runToHere({ nodes: [], edges: [] }, 'x')).toBeNull();
  });
});

describe('audit 2 · preview', () => {
  const ids = (es: Record<string, unknown>[] | undefined) => (es ?? []).map((e) => e['payment_id']);

  it('#7 a source gives the same events wherever you preview, and honours the Generator seed', () => {
    const g: Graph = {
      nodes: [
        node('a', 'Generator'),
        node('b', 'Generator', { seed: 7 }),
        node('f', 'Filter', { expr: 'true' }),
        node('u', 'Union'),
      ],
      edges: [edge('b', 'f'), edge('a', 'u'), edge('b', 'u')],
    };
    const atF = ids(runToHere(g, 'f')!.input['main']);
    const atU = ids(runToHere(g, 'u')!.input['main']!.slice(5));
    expect(atU).toEqual(atF);
    const g2: Graph = { nodes: [node('b', 'Generator', { seed: 999 })], edges: [] };
    expect(ids(runToHere(g2, 'b')!.run.out['main'])).not.toEqual(ids(runToHere(g, 'b')!.run.out['main']));
  });

  it('#8 windows use the source event-time field, not a hard-coded name; min/max of timestamps', () => {
    const schema = [
      { name: 'card_id', type: 'string', required: true },
      { name: 'paid_at', type: 'timestamp', required: true },
    ];
    const g: Graph = {
      nodes: [
        node('s', 'Source', { schema, eventTime: 'paid_at' }),
        node('w', 'Window', {
          sizeMs: 60000,
          keyBy: [],
          aggregates: [{ fn: 'max', field: 'paid_at', as: 'last' }],
        }),
      ],
      edges: [edge('s', 'w')],
    };
    const rows = runToHere(g, 'w', 10)!.run.out['main']!;
    expect(rows.every((r) => !String(r['window_start']).startsWith('1970'))).toBe(true);
    expect(rows.every((r) => typeof r['last'] === 'string' && String(r['last']).startsWith('2026'))).toBe(
      true,
    );
  });

  it('#9 Top-N sorts timestamps', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator'),
        node('t', 'Top-N', { partitionBy: [], orderBy: 'event_time', desc: true, n: 5 }),
      ],
      edges: [edge('gen', 't')],
    };
    const ts = runToHere(g, 't', 10)!.run.out['main']!.map((e) => Date.parse(String(e['event_time'])));
    expect(ts).toEqual([...ts].sort((x, y) => y - x));
  });

  it('#10 a field missing after a left-join miss is null to CEL, not a failure', () => {
    const refunds = [
      { name: 'refund_id', type: 'string', required: true },
      { name: 'payment_id', type: 'string', required: true },
      { name: 'event_time', type: 'timestamp', required: true },
    ];
    const g: Graph = {
      nodes: [
        node('p', 'Generator'),
        node('r', 'Source', { schema: refunds }),
        node('j', 'Join', {
          kind: 'left',
          leftKey: 'payment_id',
          rightKey: 'payment_id',
          lowerMs: 0,
          upperMs: 1,
        }),
        node('f', 'Filter', { expr: 'refund_id == null' }),
      ],
      edges: [edge('p', 'j', 'main', 'left'), edge('r', 'j', 'main', 'right'), edge('j', 'f')],
    };
    const run = runToHere(g, 'f')!.run;
    expect(run.failed).toBe(0);
    expect(run.out['main']).toHaveLength(5);
  });

  it('#11 a disabled Filter passes events on its main output only; Union tags by input', () => {
    const g: Graph = {
      nodes: [node('gen', 'Generator'), { ...node('f', 'Filter', { expr: 'false' }), disabled: true }],
      edges: [edge('gen', 'f')],
    };
    const out = runToHere(g, 'f')!.run.out;
    expect([out['main']?.length, out['rejected']?.length ?? 0]).toEqual([5, 0]);
    const u: Graph = {
      nodes: [node('a', 'Generator'), node('b', 'Generator'), node('u', 'Union', { tagField: 'src' })],
      edges: [edge('a', 'u'), edge('b', 'u')],
    };
    expect(new Set(runToHere(u, 'u')!.run.out['main']!.map((e) => e['src']))).toEqual(new Set(['a', 'b']));
  });
});
