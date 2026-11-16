import { Button, EmptyState } from '@sl/ui';
import { Lightbulb, Route as RouteIcon } from 'lucide-react';
import { create } from 'zustand';
import { AppError } from '@sl/errors';
import { startExplain, tracedRun, useExplain, useExplainError } from './ExplainCard';
import { useRun } from './run';
import { useGraph } from './store';
import { traceRow, type TraceStep } from './trace';

/**
 * EXPL-03 Trace (board E06): pick an output row and the canvas marks every node behind it with its step number
 * (nodes that did not contribute dim, as in Explain); the Trace tab lists them with a summary each.
 */
export const useTrace = create<{ sink: string; row: number; steps: TraceStep[] } | null>(() => null);

/**
 * A node's number in the current trace (1-based), null if it did not contribute, undefined with no trace. The
 * row's own sink stays lit (board E06), numbered after the last step: it records no lineage hop of its own.
 */
export const useTraceStep = (id: string) =>
  useTrace((s) => {
    if (!s) return undefined;
    if (id === s.sink) return s.steps.length + 1;
    const i = s.steps.findIndex((x) => x.node === id);
    return i < 0 ? null : i + 1;
  });

// Marks belong to one run of one pipeline: a reset, an edit (the run is stale), a new run or another pipeline
// ends the trace and the explanation (their row indexes would point into something else).
const end = () => {
  if (useTrace.getState()) useTrace.setState(null, true);
  if (useExplain.getState()) useExplain.setState(null, true);
};
useRun.subscribe((r, old) => {
  if (r.state === 'ready' || (r.stale && !old.stale) || (r.state === 'running' && old.state === 'finished'))
    end();
});
useGraph.subscribe((g, old) => {
  if (g.pipelineId !== old.pipelineId) end();
});

export async function startTrace(sink: string, row: number) {
  let trace;
  try {
    trace = await tracedRun();
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return void useExplainError.setState({ error: e }); // EXPLAIN-UNAVAILABLE, said by the card
  }
  const steps = traceRow(useGraph.getState(), trace, sink, row);
  useTrace.setState(steps.length ? { sink, row, steps } : null, true);
}

export function TracePanel() {
  const t = useTrace();
  if (!t)
    return (
      <EmptyState icon={RouteIcon} title="Pick an output row to trace it" level={3}>
        In the Output tab, pick a row: every input and node behind it is marked on the canvas.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {t.steps.map((s, i) => (
          // Board E06: light rose badges (11px mono), 13px rows, a 170px label column.
          <li key={s.node} className="flex items-baseline gap-3 text-[13px]">
            <span
              aria-hidden="true"
              className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-rose-50 font-mono text-[11px] font-semibold text-rose-700"
            >
              {i + 1}
            </span>
            <span className="w-[170px] shrink-0 font-medium text-ink">{s.label}</span>
            <span className="text-muted">{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          size="sm"
          icon={<Lightbulb size={14} aria-hidden="true" />}
          onClick={() => void startExplain(t.sink, t.row)}
        >
          Explain step by step
        </Button>
        <Button size="sm" variant="ghost" onClick={() => useTrace.setState(null, true)}>
          Clear trace
        </Button>
      </div>
    </div>
  );
}
