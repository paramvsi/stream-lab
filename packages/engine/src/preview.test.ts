import { spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { runToHere } from './preview';

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

describe('NODE-04/05 · preview (the engine, tapped at one node)', () => {
  it('n events per source, deterministic, typed', () => {
    const g: Graph = { nodes: [node('gen', 'Generator', { duplicatePct: 0 })], edges: [] };
    const a = runToHere(g, 'gen')!.out['main']!;
    expect(a).toHaveLength(5);
    expect(runToHere(g, 'gen')!.out['main']).toEqual(a);
    expect(typeof a.find((e) => e['amount'] !== null)!['amount']).toBe('number');
    expect(['AED', 'USD', 'EUR']).toContain(a[0]!['currency']);
  });

  it('Filter splits on the expression; rejected gets the rest; bad rows fail', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { badRowsPct: 0, duplicatePct: 0 }),
        node('f', 'Filter', { expr: 'amount > 1000.0' }),
      ],
      edges: [edge('gen', 'f')],
    };
    const p = runToHere(g, 'f', 20)!;
    expect(p.input['main']).toHaveLength(20);
    expect(p.out['main']!.every((e) => (e['amount'] as number) > 1000)).toBe(true);
    expect(p.out['main']!.length + p.out['rejected']!.length).toBe(20);
    expect(p.failed).toBe(0);
  });

  it('Map adds a computed field; Window shows open windows as state per key', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { badRowsPct: 0 }),
        node('m', 'Map', { assignments: [{ field: 'amount_x2', expr: 'amount * 2.0', type: 'number' }] }),
        node('w', 'Window', { sizeMs: 3600000, keyBy: ['card_id'] }),
      ],
      edges: [edge('gen', 'm'), edge('m', 'w')],
    };
    const e0 = runToHere(g, 'm')!.out['main']![0]!;
    expect(e0['amount_x2']).toBeCloseTo((e0['amount'] as number) * 2);
    const w = runToHere(g, 'w', 12)!;
    expect(w.state!.length).toBeGreaterThan(0);
    expect(w.state!.every((s) => /^c_\d+$/.test(String(s['card_id'])) && /–/.test(String(s['window'])))).toBe(
      true,
    );
    // The final watermark flushes the windows into the output.
    expect(w.out['main']!.length).toBe(w.state!.length);
  });

  it('a bad expression counts each event as failed; an unknown node gives null', () => {
    const g: Graph = {
      nodes: [node('gen', 'Generator', { duplicatePct: 0 }), node('f', 'Filter', { expr: 'nope > 1' })],
      edges: [edge('gen', 'f')],
    };
    expect(runToHere(g, 'f')!.failed).toBe(5);
    expect(runToHere({ nodes: [], edges: [] }, 'x')).toBeNull();
  });

  it('a source gives the same events wherever you preview, and honours the Generator seed', () => {
    const g: Graph = {
      nodes: [
        node('a', 'Generator'),
        node('b', 'Generator', { seed: 7 }),
        node('f', 'Filter', { expr: 'true' }),
        node('u', 'Union'),
      ],
      edges: [edge('b', 'f'), edge('a', 'u'), edge('b', 'u')],
    };
    const atF = runToHere(g, 'f')!.input['main']!;
    expect(runToHere(g, 'u')!.input['main']).toEqual(expect.arrayContaining(atF));
    const g2: Graph = { nodes: [node('b', 'Generator', { seed: 999 })], edges: [] };
    expect(runToHere(g2, 'b')!.out['main']).not.toEqual(runToHere(g, 'b')!.out['main']);
  });

  it('a field missing after a left-join miss is null to CEL, not a failure', () => {
    const refunds = [
      { name: 'refund_id', type: 'string', required: true },
      { name: 'payment_id', type: 'string', required: true },
      { name: 'event_time', type: 'timestamp', required: true },
    ];
    const g: Graph = {
      nodes: [
        node('p', 'Generator', { duplicatePct: 0 }),
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
    const p = runToHere(g, 'f')!;
    expect(p.failed).toBe(0);
    const misses = p.input['main']!.filter((e) => e['refund_id'] == null);
    expect(misses.length).toBeGreaterThan(0);
    expect(p.out['main']).toEqual(misses);
  });

  it('a disabled Filter passes events on its main output only; Union tags by input label', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { duplicatePct: 0 }),
        { ...node('f', 'Filter', { expr: 'false' }), disabled: true },
      ],
      edges: [edge('gen', 'f')],
    };
    const out = runToHere(g, 'f')!.out;
    expect([out['main']?.length, out['rejected']?.length ?? 0]).toEqual([5, 0]);
    const u: Graph = {
      nodes: [
        { ...node('a', 'Generator'), label: 'Cards' },
        { ...node('b', 'Generator'), label: 'Wallets' },
        node('u', 'Union', { tagField: 'src' }),
      ],
      edges: [edge('a', 'u'), edge('b', 'u')],
    };
    expect(new Set(runToHere(u, 'u')!.out['main']!.map((e) => e['src']))).toEqual(
      new Set(['Cards', 'Wallets']),
    );
  });
});
