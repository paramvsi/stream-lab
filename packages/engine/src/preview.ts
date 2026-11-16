import type { Graph } from '@sl/graph';
import { createRun, type RunOptions } from './engine';
import type { Event } from './random';

export interface Preview {
  /** What reached the node, per input port. */
  input: Record<string, Event[]>;
  /** What it emitted, per output port. */
  out: Record<string, Event[]>;
  /** Open state per key before the end of the sample (Window: open windows; Deduplicate: keys seen). */
  state?: Event[];
  /** Events whose expression failed in this node (each counted once). */
  failed: number;
}

/**
 * NODE-04 live preview / NODE-05 Run to here: the real engine on `n` events per source, tapped at one node.
 * Sources keep their watermark at the end of the sample so open state can be read, then the final watermark
 * flushes what is left (as at the end of a bounded input).
 */
export function runToHere(
  g: Graph,
  nodeId: string,
  n = 5,
  // The pipeline's seed and Data-drawer generator, so the preview shows what a run would (DATA-01).
  data: Pick<RunOptions, 'seed' | 'generator' | 'sourceData' | 'refTables'> = {},
): Preview | null {
  if (!g.nodes.some((x) => x.id === nodeId)) return null;
  const run = createRun(g, { sample: n, tap: nodeId, holdFinalWatermark: true, seed: 42, ...data });
  run.advance(run.stats().total);
  const state = run.snapshot(nodeId);
  run.step(); // final watermark
  const { input, output } = run.tapped();
  return { input, out: output, ...(state ? { state } : {}), failed: run.stats().nodes[nodeId]?.failed ?? 0 };
}
