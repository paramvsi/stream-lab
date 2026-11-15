import type { PipelineEdge, PipelineNode } from '@sl/graph';
import ELK from 'elkjs/lib/elk.bundled.js';

export const W = 184;
export const H = 64;
export const SNAP_PX = 6;

type Pos = { x: number; y: number };

/** SIM-13: elkjs `layered`, direction RIGHT, spacing 64 (within a layer) / 96 (between layers). */
export async function autoLayout(nodes: PipelineNode[], edges: PipelineEdge[]): Promise<Record<string, Pos>> {
  const elk = new ELK();
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
    },
    children: nodes.map((n) => ({ id: n.id, width: W, height: H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  return Object.fromEntries((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}

export interface Guides {
  /** Snapped position for the dragged node. */
  pos: Pos;
  /** Flow-space x of a vertical guide line, and y of a horizontal one, if any. */
  x?: number;
  y?: number;
}

/**
 * SIM-05 helper lines: align the dragged node's left/centre/right (and top/middle/bottom) with any other
 * node's, when within 6 px. Returns the snapped position and the guide lines to draw.
 */
export function snapGuides(pos: Pos, others: Pos[], threshold = SNAP_PX): Guides {
  const xs = (p: Pos) => [p.x, p.x + W / 2, p.x + W];
  const ys = (p: Pos) => [p.y, p.y + H / 2, p.y + H];
  let best: { d: number; shift: number; line: number } | null = null;
  let bestY: { d: number; shift: number; line: number } | null = null;
  for (const o of others) {
    for (const a of xs(pos))
      for (const b of xs(o)) {
        const d = Math.abs(a - b);
        if (d <= threshold && (!best || d < best.d)) best = { d, shift: b - a, line: b };
      }
    for (const a of ys(pos))
      for (const b of ys(o)) {
        const d = Math.abs(a - b);
        if (d <= threshold && (!bestY || d < bestY.d)) bestY = { d, shift: b - a, line: b };
      }
  }
  return {
    pos: { x: pos.x + (best?.shift ?? 0), y: pos.y + (bestY?.shift ?? 0) },
    ...(best ? { x: best.line } : {}),
    ...(bestY ? { y: bestY.line } : {}),
  };
}
