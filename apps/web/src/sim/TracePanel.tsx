import { Button, EmptyState } from '@sl/ui';
import { Lightbulb, Route as RouteIcon } from 'lucide-react';
import { create } from 'zustand';
import { AppError } from '@sl/errors';
import { startExplain, tracedRun, useExplainError } from './ExplainCard';
import { useGraph } from './store';
import { traceRow, type TraceStep } from './trace';

/**
 * EXPL-03 Trace (board E06): pick an output row and the canvas marks every node behind it with its step number
 * (nodes that did not contribute dim, as in Explain); the Trace tab lists them with a summary each.
 */
export const useTrace = create<{ sink: string; row: number; steps: TraceStep[] } | null>(() => null);

/** A node's number in the current trace (1-based), null if it did not contribute, undefined with no trace. */
export const useTraceStep = (id: string) =>
  useTrace((s) => {
    if (!s) return undefined;
    const i = s.steps.findIndex((x) => x.node === id);
    return i < 0 ? null : i + 1;
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
          <li key={s.node} className="flex items-baseline gap-3 text-[14px]">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-rose-600 font-mono text-[12px] font-semibold text-white"
            >
              {i + 1}
            </span>
            <span className="font-medium text-ink">{s.label}</span>
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
