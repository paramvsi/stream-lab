import { graphLayers, type JobGraph } from '@sl/flink';
import { StatusBadge } from '@sl/ui';
import { ArrowRight } from 'lucide-react';
import { Fragment } from 'react';
import { TONE, word } from './Jobs';

/**
 * JOB-02 / board D08 "Job graph": operators in columns left to right (graphLayers), the ship strategy between
 * columns, each card with its parallelism and, when not running, its status in words. It is a list: each item
 * says what it receives from and how, so the edges are there for a screen reader too.
 * ponytail: the Busy / Backpressure / Skew colouring and per-operator rec/s and busy % need vertex metrics
 * (JOB-03); a wide or crossing-heavy graph wants elkjs + @xyflow/react.
 */
export function JobGraphView({ graph }: { graph: JobGraph }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const layers = graphLayers(graph);
  const col = new Map(layers.flatMap((ids, i) => ids.map((id) => [id, i] as const)));
  // The strategies of the edges that end in a column: shown before it.
  const into = (i: number) => [
    ...new Set(graph.edges.filter((e) => col.get(e.to) === i).map((e) => e.ship ?? 'FORWARD')),
  ];
  return (
    <ul
      aria-label="Job graph"
      className="m-0 flex list-none flex-wrap items-center gap-3 overflow-x-auto rounded-lg border border-line bg-surface p-4"
    >
      {layers.map((ids, i) => (
        <Fragment key={ids.join('|')}>
          {i > 0 && (
            <li aria-hidden="true" className="flex flex-col items-center gap-1 text-[11px] text-muted">
              {into(i).map((s) => (
                <span key={s} className="font-mono">
                  {s}
                </span>
              ))}
              <ArrowRight size={16} />
            </li>
          )}
          {ids.map((id) => {
            const n = byId.get(id)!;
            const ins = graph.edges.filter((e) => e.to === id);
            return (
              <li
                key={id}
                aria-label={n.name}
                className="flex min-w-[180px] flex-col gap-1 rounded-md border border-line bg-surface p-3"
              >
                <h3 className="m-0 text-[14px] font-semibold">{n.name}</h3>
                <span className="font-mono text-[12px] text-muted">p {n.parallelism}</span>
                {n.status !== 'RUNNING' && (
                  <StatusBadge tone={TONE[n.status] ?? 'neutral'}>{word(n.status)}</StatusBadge>
                )}
                {ins.length > 0 && (
                  <span className="sr-only">
                    {ins
                      .map((e) => `from ${byId.get(e.from)?.name ?? e.from} (${e.ship ?? 'FORWARD'})`)
                      .join(', ')}
                  </span>
                )}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
}
