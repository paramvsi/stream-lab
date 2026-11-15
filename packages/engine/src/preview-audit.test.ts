import { spec, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import * as P from './preview';

// Guards for audit 3 (01e5c27 + 4debbce). `pv` reads both the old ({input, run}) and new preview shapes,
// so these can be shown failing on the old mini-engine.
type Rows = Record<string, unknown>[];
type Shape = { input: Record<string, Rows>; out: Record<string, Rows>; state?: Rows; failed: number };
const pv = (g: Graph, id: string, n = 5): Shape => {
  const p = P.runToHere(g, id, n) as unknown as Record<string, unknown>;
  const r = (p['run'] ?? p) as Shape;
  return { ...r, input: p['input'] as Shape['input'] };
};
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

describe('audit 3 · preview on the engine', () => {
  it('#2 a failure counts once per event (Map with two failing fields, Route with two failing rules)', () => {
    const map: Graph = {
      nodes: [
        node('gen', 'Generator'),
        node('m', 'Map', {
          assignments: [
            { field: 'a', expr: 'nope + 1.0', type: 'number' },
            { field: 'b', expr: 'nope + 2.0', type: 'number' },
          ],
        }),
      ],
      edges: [edge('gen', 'm')],
    };
    expect(pv(map, 'm').failed).toBe(5);
    const route: Graph = {
      nodes: [
        node('gen', 'Generator', { badRowsPct: 0 }),
        node('r', 'Route', {
          routes: [
            { id: 'x', name: 'x', expr: 'nope > 1.0' },
            { id: 'y', name: 'y', expr: 'nope > 2.0' },
          ],
        }),
      ],
      edges: [edge('gen', 'r')],
    };
    const r = pv(route, 'r');
    expect(r.failed).toBe(5);
    // #1 a failed event goes to the dead letter, not on to the default branch.
    expect(r.out['default'] ?? []).toHaveLength(0);
  });

  it('#4 window state has one row per key and window, also for windows under a minute', () => {
    const g: Graph = {
      nodes: [node('gen', 'Generator'), node('w', 'Window', { sizeMs: 10000, keyBy: ['card_id'] })],
      edges: [edge('gen', 'w')],
    };
    const st = pv(g, 'w', 50).state!;
    const ids = st.map((r) => JSON.stringify([r['card_id'], r['window']]));
    expect(st.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('#5 a disabled Join passes its left input, whatever order the edges were made in', () => {
    const g: Graph = {
      nodes: [
        node('a', 'Generator', { seed: 1 }),
        node('b', 'Generator', { seed: 2 }),
        node('j', 'Join', {}, true),
      ],
      edges: [edge('b', 'j', 'main', 'right'), edge('a', 'j', 'main', 'left')],
    };
    const p = pv(g, 'j');
    expect(p.out['main']).toEqual(p.input['left']);
  });

  it('#6 the window type matters: sliding windows give more rows than tumbling', () => {
    const g = (kind: string): Graph => ({
      nodes: [
        node('gen', 'Generator'),
        node('w', 'Window', { kind, sizeMs: 60000, slideMs: 10000, keyBy: [] }),
      ],
      edges: [edge('gen', 'w')],
    });
    expect(pv(g('hop'), 'w', 20).out['main']!.length).toBeGreaterThan(
      pv(g('tumble'), 'w', 20).out['main']!.length,
    );
  });
});
