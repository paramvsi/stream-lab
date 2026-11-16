import type { Trace, TraceHop } from '@sl/engine';
import { configOf, labelOf, topoOrder, type Graph } from '@sl/graph';

/**
 * EXPL-03 Trace (board E06): everything behind one output row — every contributing input event and every node
 * it went through — summarised per node in pipeline order. Unlike Explain, it follows all parents, not one path.
 */
export interface TraceStep {
  node: string;
  label: string;
  text: string;
  /** How many of this node's events contributed. */
  count: number;
}

const hms = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 19) : '—');

export function traceRow(g: Graph, t: Trace, sink: string, row: number): TraceStep[] {
  const id = t.outputs[sink]?.[row];
  if (id === undefined) return [];
  const byNode = new Map<string, TraceHop[]>();
  const seen = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const h = t.hops.get(stack.pop()!);
    if (!h || seen.has(h.id)) continue;
    seen.add(h.id);
    byNode.set(h.node, [...(byNode.get(h.node) ?? []), h]);
    stack.push(...h.parents);
  }
  return topoOrder(g)
    .filter((n) => byNode.has(n.id))
    .map((n) => {
      const hops = byNode.get(n.id)!;
      const c = configOf(n) as Record<string, unknown>;
      // A loop, not Math.min(...ts): a window can hold far more events than a call can take arguments.
      let lo = Infinity;
      let hi = -Infinity;
      for (const h of hops) {
        lo = Math.min(lo, h.ts);
        hi = Math.max(hi, h.ts);
      }
      let text: string;
      switch (n.type) {
        case 'Source':
        case 'Generator':
          text =
            hops.length === 1 ? `1 event at ${hms(lo)}` : `${hops.length} events, ${hms(lo)} to ${hms(hi)}`;
          break;
        case 'Validate': {
          const k = ((c['rules'] ?? []) as unknown[]).length;
          text = `All ${k} passed`;
          break;
        }
        case 'Window': {
          // A late event leaves on the late port (no window_end): it was set aside, not part of a firing.
          const fired = hops.find((h) => h.port === 'main');
          text = fired
            ? `Fired at watermark ${hms(Date.parse(String(fired.data['window_end'])))}`
            : 'Set aside as late (its window had fired)';
          break;
        }
        case 'Route': {
          const routes = (c['routes'] ?? []) as { id: string; name: string }[];
          const port = hops[0]!.port;
          text = `→ ${port === 'default' ? 'the default branch' : (routes.find((r) => `route-${r.id}` === port)?.name ?? port)}`;
          break;
        }
        case 'Filter':
          text = `${String(c['expr'])} · ${hops.length} passed`;
          break;
        case 'Lookup':
          text = `Joined with ${String(c['table'])}`;
          break;
        default:
          text = `${hops.length} event${hops.length === 1 ? '' : 's'}`;
      }
      return { node: n.id, label: labelOf(n), text, count: hops.length };
    });
}
