import { AppError, present } from '@sl/errors';
import { graphLayers, type Backpressure, type JobGraph } from '@sl/flink';
import { StatusBadge } from '@sl/ui';
import { ArrowRight } from 'lucide-react';
import { useId } from 'react';
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
export function JobGraphView({
  graph,
  note,
  selected = null,
  onSelect,
  backpressure = {},
}: {
  graph: JobGraph;
  /** Per vertex id; null or missing is no reading. */
  backpressure?: Record<string, Backpressure | null | undefined>;
  /** Under the title, e.g. "Backpressure from 2 min ago." when the readings are stale (§4). */
  note?: string;
  /** JOB-03: a card's name opens that operator's panel; the open one is pressed. */
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const layers = graphLayers(graph);
  const titleId = useId();
  return (
    <div className="flex flex-col gap-3">
      <h2 id={titleId} className="m-0 text-[16px] font-semibold">
        Job graph
      </h2>
      {note && <p className="m-0 text-[13px] text-muted">{note}</p>}
      {/* A scroll region the keyboard can reach (WebKit does not focus scrollers by itself), as Table does. */}
      <div
        role="region"
        aria-labelledby={titleId}
        tabIndex={0}
        className="sl-focus overflow-x-auto rounded-lg border border-line bg-surface p-4"
      >
        <ol aria-label="Job graph" className="m-0 flex list-none flex-nowrap items-start gap-3 p-0">
          {layers.map((ids, i) => (
            <li key={ids.join('|')} className="flex items-center gap-3">
              {i > 0 && <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-muted" />}
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {ids.map((id) => {
                  const n = byId.get(id)!;
                  const ins = graph.edges.filter((e) => e.to === id);
                  return (
                    <li
                      key={id}
                      className="flex min-w-[180px] flex-col gap-1 rounded-md border border-line p-3"
                    >
                      <h3 className="m-0 text-[14px] font-semibold">
                        {onSelect ? (
                          <button
                            type="button"
                            aria-pressed={selected === id}
                            onClick={() => onSelect(id)}
                            className={`sl-focus -mx-1 cursor-pointer rounded-sm border-0 bg-transparent px-1 text-left font-semibold text-ink ${selected === id ? 'underline decoration-rose-600 decoration-2 underline-offset-4' : ''}`}
                          >
                            {n.name}
                          </button>
                        ) : (
                          n.name
                        )}
                      </h3>
                      <span className="font-mono text-[12px] text-muted">p {n.parallelism}</span>
                      {backpressure[id]?.level === 'high' && (
                        // JOB-BACKPRESSURE (D08b): an object badge on the operator; HIGH is the catalog's trigger.
                        <StatusBadge
                          tone="warning"
                          reason={
                            present(
                              new AppError('JOB-BACKPRESSURE', {
                                operator: n.name,
                                pct: backpressure[id]!.pct,
                              }),
                            ).message
                          }
                        >
                          backpressured {backpressure[id]!.pct}%
                        </StatusBadge>
                      )}
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
    </div>
  );
}
