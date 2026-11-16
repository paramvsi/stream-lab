import { createRun } from '@sl/engine';
import { effectiveGenerator } from '@sl/graph';
import { Button, IconButton } from '@sl/ui';
import { Lightbulb, Pause, Play, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';
import { explainPath, type ExplainStep } from './explain';
import { useRefTables } from './refTables';
import { uploadedRows } from './run';
import { useGraph } from './store';

/**
 * EXPL-02 Explain this run (boards E01–E05, SIMULATOR.md "Explain"): the pipeline is run again with lineage on
 * (deterministic, SIM-24: the same events as the run shown), one output row's path is picked, and a card steps
 * through it — nodes off the path dim to 35%, path nodes carry their step number. ←/→ move, Esc exits.
 */
export const useExplain = create<{ steps: ExplainStep[]; at: number; playing: boolean } | null>(() => null);

/** Node ids on the path, with their step number (1-based), for the canvas. */
export const useExplainStep = (id: string) =>
  useExplain((s) => {
    if (!s) return undefined;
    const i = s.steps.findIndex((x) => x.node === id);
    return i < 0 ? null : i + 1;
  });

/**
 * Explain `row` of `sink` (an Output tab row), or a random output row when none is given. Returns false when the
 * run has no output to explain.
 */
export async function startExplain(sink?: string, row?: number): Promise<boolean> {
  const { nodes, edges, seed, data, pipelineId } = useGraph.getState();
  const { sourceData } = await uploadedRows(pipelineId, nodes, data);
  const run = createRun(
    { nodes, edges },
    {
      seed,
      sourceData,
      generator: effectiveGenerator(data.generator, seed),
      refTables: useRefTables.getState().user,
      trace: true,
    },
  );
  run.advance(Infinity);
  const trace = run.trace()!;
  const sinks = nodes
    .filter((n) => n.type === 'Sink' && (trace.outputs[n.id]?.length ?? 0) > 0)
    .map((n) => n.id);
  const pick = sink ?? sinks[0];
  if (!pick || !trace.outputs[pick]?.length) return false;
  const i = row ?? Math.floor(Math.random() * trace.outputs[pick].length);
  const steps = explainPath({ nodes, edges }, trace, pick, i);
  if (!steps.length) return false;
  useExplain.setState({ steps, at: 0, playing: false }, true);
  return true;
}

const exit = () => useExplain.setState(null, true);

export function ExplainCard() {
  const s = useExplain();
  const titleId = useId();
  const next = useRef<HTMLButtonElement>(null);
  const open = s !== null;
  // Keys: ←/→ step, Esc exits (not while another dialog is open: that Escape is theirs).
  useEffect(() => {
    if (!open) return;
    next.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const st = useExplain.getState();
      if (!st || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]:not([data-explain-card]):not([data-tour-card])')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowRight') useExplain.setState({ at: Math.min(st.at + 1, st.steps.length - 1) });
      else if (e.key === 'ArrowLeft') useExplain.setState({ at: Math.max(st.at - 1, 0) });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  // Auto-play: a step every 2.5 s, stopping at the last.
  useEffect(() => {
    if (!s?.playing) return;
    const t = setInterval(() => {
      const st = useExplain.getState();
      if (!st) return;
      if (st.at >= st.steps.length - 1) useExplain.setState({ playing: false });
      else useExplain.setState({ at: st.at + 1 });
    }, 2500);
    return () => clearInterval(t);
  }, [s?.playing]);
  if (!s) return null;
  const step = s.steps[s.at]!;
  const last = s.at === s.steps.length - 1;
  return (
    <div
      data-explain-card
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed bottom-[276px] left-1/2 z-40 flex w-[440px] -translate-x-1/2 flex-col gap-2 rounded-xl bg-surface p-5 shadow-pop"
    >
      <div className="flex items-center gap-2">
        <Lightbulb size={16} aria-hidden="true" className="text-rose-700" />
        <p className="m-0 font-mono text-[12px] font-semibold tracking-wide text-rose-700">
          EXPLAIN THIS RUN · {s.at + 1} OF {s.steps.length}
        </p>
        <IconButton aria-label="Exit explain" size="sm" bordered={false} className="ml-auto" onClick={exit}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <h2 id={titleId} className="m-0 text-[17px] font-semibold">
        {step.title}
      </h2>
      {/* Announced as each step changes. */}
      <p className="m-0 text-[14px] text-muted" aria-live="polite">
        {step.text}
      </p>
      <div className="flex items-center gap-2 pt-2">
        {s.at > 0 && (
          <Button size="sm" variant="ghost" onClick={() => useExplain.setState({ at: s.at - 1 })}>
            Back
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={s.playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          onClick={() => useExplain.setState({ playing: !s.playing })}
          {...(last && !s.playing ? { disabledReason: 'This is the last step.' } : {})}
        >
          {s.playing ? 'Pause' : 'Auto-play'}
        </Button>
        <Button
          ref={next}
          size="sm"
          variant="primary"
          onClick={() => (last ? exit() : useExplain.setState({ at: s.at + 1 }))}
        >
          {last ? 'Done' : 'Next'}
        </Button>
      </div>
    </div>
  );
}

/** Header "Explain run" (SIMULATOR.md header; W09). */
export function ExplainButton() {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Lightbulb size={16} aria-hidden="true" />}
      onClick={() => void startExplain()}
    >
      Explain run
    </Button>
  );
}
