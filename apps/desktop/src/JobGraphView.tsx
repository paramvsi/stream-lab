import { graphLayers, type JobGraph } from '@sl/flink';
import { StatusBadge } from '@sl/ui';
import { ArrowRight } from 'lucide-react';
import { TONE, word } from './Jobs';

/**
 * JOB-02 / board D08 "Job graph": operators in columns left to right (graphLayers), one column per layer, stacked,
 * in one row that scrolls (never wraps). Each card shows its parallelism, its status in words when not running,
 * and one visible line per input ("from X · HASH"): so a join, or an edge that skips a column, is said exactly,
 * never implied by position. A strategy Flink did not give is left out (not guessed). The arrows between columns
 * are decoration only.
 * ponytail: no drawn edges or crossing layout; a wide or crossing-heavy graph wants elkjs + @xyflow/react. The
 * Busy / Backpressure / Skew colouring and per-operator rec/s and busy % need vertex metrics (JOB-03).
 */
export function JobGraphView({ graph }: { graph: JobGraph }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const layers = graphLayers(graph);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface p-4">
      <ol aria-label="Job graph" className="m-0 flex list-none flex-nowrap items-start gap-3 p-0">
        {layers.map((ids, i) => (
          <li key={ids.join('|')} className="flex items-center gap-3">
            {i > 0 && <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-muted" />}
            <ul aria-label={`Stage ${i + 1}`} className="m-0 flex list-none flex-col gap-3 p-0">
              {ids.map((id) => {
                const n = byId.get(id)!;
                const ins = graph.edges.filter((e) => e.to === id);
                return (
                  <li
                    key={id}
                    className="flex min-w-[180px] flex-col gap-1 rounded-md border border-line p-3"
                  >
                    <h3 className="m-0 text-[14px] font-semibold">{n.name}</h3>
                    <span className="font-mono text-[12px] text-muted">p {n.parallelism}</span>
                    {n.status !== 'RUNNING' && (
                      <StatusBadge tone={TONE[n.status] ?? 'neutral'}>{word(n.status)}</StatusBadge>
                    )}
                    {ins.map((e) => (
                      <span key={`${e.from}-${e.num}`} className="text-[12px] text-muted">
                        from {byId.get(e.from)?.name ?? e.from}
                        {e.ship ? ` · ${e.ship}` : ''}
                      </span>
                    ))}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
