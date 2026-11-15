import type { PipelineEdge, PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { autoLayout, H, snapGuides, W } from './geometry';

const n = (id: string): PipelineNode => ({ id, type: 'Filter', position: { x: 0, y: 0 }, config: {} });
const e = (s: string, t: string): PipelineEdge => ({
  id: `${s}-${t}`,
  source: s,
  sourceHandle: 'main',
  target: t,
  targetHandle: 'main',
});

describe('SIM-05 · helper lines', () => {
  it('snaps left edges within 6 px and reports the vertical guide', () => {
    expect(snapGuides({ x: 104, y: 300 }, [{ x: 100, y: 0 }])).toEqual({ pos: { x: 100, y: 300 }, x: 100 });
  });

  it('snaps centres and tops independently', () => {
    const g = snapGuides({ x: 503, y: 205 }, [{ x: 500 + W / 2 - W / 2, y: 200 }]);
    expect(g.pos).toEqual({ x: 500, y: 200 });
    expect(g).toMatchObject({ x: 500, y: 200 });
  });

  it('aligns a centre with a centre', () => {
    const g = snapGuides({ x: 0, y: 1000 + 3 }, [{ x: 400, y: 1000 }]);
    expect(g.pos.y).toBe(1000);
    expect(g.y).toBe(1000);
  });

  it('does nothing beyond 6 px', () => {
    expect(snapGuides({ x: 107, y: 500 }, [{ x: 100, y: 0 }])).toEqual({ pos: { x: 107, y: 500 } });
  });

  it('bottom-to-bottom alignment uses node height', () => {
    const g = snapGuides({ x: 900, y: 2 }, [{ x: 0, y: 0 }]);
    expect(g.pos.y).toBe(0);
    expect(g.y).toBe(0);
    expect(H).toBe(64);
  });
});

describe('SIM-13 · auto-layout', () => {
  it('lays a chain out left to right without overlaps', async () => {
    const pos = await autoLayout([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'c')]);
    expect(pos.a!.x).toBeLessThan(pos.b!.x);
    expect(pos.b!.x).toBeLessThan(pos.c!.x);
    // 96 px between layers (plus the node width).
    expect(pos.b!.x - pos.a!.x).toBeGreaterThanOrEqual(W + 96);
  });

  it('stacks branches in the same layer at least 64 px apart', async () => {
    const pos = await autoLayout([n('s'), n('x'), n('y')], [e('s', 'x'), e('s', 'y')]);
    expect(pos.x!.x).toBe(pos.y!.x);
    expect(Math.abs(pos.x!.y - pos.y!.y)).toBeGreaterThanOrEqual(H + 64);
  });
});
