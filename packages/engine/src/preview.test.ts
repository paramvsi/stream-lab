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
