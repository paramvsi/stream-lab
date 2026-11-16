import { createRun, type Trace } from '@sl/engine';
import { AppError, present } from '@sl/errors';
import { Button, IconButton, useToast } from '@sl/ui';
import { Lightbulb, Pause, Play, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';
import { explainPath, type ExplainStep } from './explain';
import { replaySource, useRun } from './run';
import { useGraph } from './store';

/**
 * EXPL-02 Explain this run (boards E01–E05, SIMULATOR.md "Explain"). The run shown is replayed with lineage on —
 * the exact pipeline and settings it was loaded with (deterministic, SIM-24), so a row is explained as it is shown;
 * not when the pipeline changed since, Chaos was injected, nothing ran yet, or the run is too big
 * (EXPLAIN-UNAVAILABLE). A card steps through one row's path: the current step's node is marked and its incoming
 * edge lit, everything else dims. ←/→ move and Esc exits when pressed on the card or with nothing else open.
 */
export const useExplain = create<{ steps: ExplainStep[]; at: number; playing: boolean } | null>(() => null);
/** EXPLAIN-UNAVAILABLE (and Trace's): shown as a toast by the card, which is always mounted in a workspace. */
export const useExplainError = create<{ error: AppError | null }>(() => ({ error: null }));

/** The current step's node gets its number; every other node dims (null); undefined when not explaining. */
export const useExplainStep = (id: string) =>
  useExplain((s) => (!s ? undefined : s.steps[s.at]?.node === id ? s.at + 1 : null));
/** The edge into the current step's node from the previous step's node is lit (board E01–E05). */
export const useExplainEdge = (source: string, target: string) =>
  useExplain((s) => !!s && s.at > 0 && s.steps[s.at]?.node === target && s.steps[s.at - 1]?.node === source);

/** The run shown, replayed with lineage on. Throws EXPLAIN-UNAVAILABLE when that is not possible. */
export async function tracedRun(): Promise<Trace> {
  const src = replaySource();
  if ('reason' in src) throw new AppError('EXPLAIN-UNAVAILABLE', { reason: src.reason });
  try {
    const run = createRun(src.graph, { ...src.opts, trace: true });
    run.advance(Infinity);
    return run.trace()!;
  } catch (e) {
    throw new AppError('EXPLAIN-UNAVAILABLE', { reason: 'the replay failed' }, e);
  }
}

let opener: HTMLElement | null = null;

/**
 * Explain `row` of `node` (a Sink or Dead-letter row in the Output tab), or a random row already shown when none
 * is given. Problems go to useExplainError (a toast).
 */
export async function startExplain(node?: string, row?: number): Promise<void> {
  const fail = (reason: string) =>
    useExplainError.setState({ error: new AppError('EXPLAIN-UNAVAILABLE', { reason }) });
  const active = document.activeElement;
  let trace: Trace;
  try {
    trace = await tracedRun();
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return void useExplainError.setState({ error: e });
  }
  const { nodes, edges } = useGraph.getState();
  // A random row is one the Output tab already shows (a running run has not shown them all).
  const shown = useRun.getState().stats?.outputs ?? {};
  const outs = nodes.filter(
    (n) => (n.type === 'Sink' || n.type === 'Dead-letter') && (shown[n.id]?.length ?? 0) > 0,
  );
  const pick = node ?? outs.find((n) => n.type === 'Sink')?.id ?? outs[0]?.id;
  const count = Math.min(shown[pick ?? '']?.length ?? 0, trace.outputs[pick ?? '']?.length ?? 0);
  if (!pick || !count) return fail('there are no output rows to explain yet');
  const i = row ?? Math.floor(Math.random() * count);
  const steps = explainPath({ nodes, edges }, trace, pick, i);
  if (!steps.length) return fail('that row has no recorded path');
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  useExplain.setState({ steps, at: 0, playing: false }, true);
}

const exit = () => {
  useExplain.setState(null, true);
  const back =
    opener && document.contains(opener)
      ? opener
      : document.querySelector<HTMLElement>('[data-explain-button]');
  requestAnimationFrame(() => back?.focus());
};

export function ExplainCard() {
  const s = useExplain();
  const titleId = useId();
  const next = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const error = useExplainError((e) => e.error);
  const open = s !== null;
  // The live region is always there (empty until Explain starts), so the first step is announced too.
  const said = s
    ? `Step ${s.at + 1} of ${s.steps.length}: ${s.steps[s.at]!.title}. ${s.steps[s.at]!.text}`
    : '';
  useEffect(() => {
    if (!error) return;
    const p = present(error);
    toast({ severity: p.severity, message: p.message });
    useExplainError.setState({ error: null });
  }, [error, toast]);
  // Leaving the workspace ends the explanation (another pipeline must not inherit its marks).
  useEffect(() => () => useExplain.setState(null, true), []);
  // Keys. Which layers are open is read before any of them handles the key (capture), and the key acts only if
  // it was pressed on the card, or with nothing else open: one Escape never closes two layers.
  useEffect(() => {
    if (!open) return;
    next.current?.focus();
    let others = false;
    const before = () => {
      others = !!document.querySelector(
        '[role="dialog"]:not([data-explain-card]), [role="menu"], [role="listbox"]',
      );
    };
    const onKey = (e: KeyboardEvent) => {
      const st = useExplain.getState();
      if (!st || !['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const t = e.target as Element | null;
      const onCard = !!t?.closest?.('[data-explain-card]');
      if (!onCard) {
        if (e.defaultPrevented || others) return;
        // Arrows belong to the widget that has focus (tabs, sliders, inputs, the canvas): only the page itself.
        if (e.key !== 'Escape' && t && t !== document.body) return;
      }
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowRight') useExplain.setState({ at: Math.min(st.at + 1, st.steps.length - 1) });
      else useExplain.setState({ at: Math.max(st.at - 1, 0) });
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', onKey);
    };
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
  return (
    <>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {s && (
        <div
          data-explain-card
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="fixed right-6 bottom-[274px] z-40 flex w-[380px] flex-col gap-2 overflow-hidden rounded-xl border-t-[3px] border-rose-600 bg-surface p-5 shadow-pop"
        >
          <div className="flex items-center gap-2">
            <Lightbulb size={16} aria-hidden="true" className="text-rose-700" />
            <p className="m-0 font-mono text-[12px] font-semibold tracking-wide text-rose-700">
              EXPLAIN THIS RUN · {s.at + 1} OF {s.steps.length}
            </p>
            <IconButton
              aria-label="Exit explain"
              size="sm"
              bordered={false}
              className="ml-auto"
              onClick={exit}
            >
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
          {/* Board E01–E05: progress through the path. */}
          <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full bg-rose-600"
              style={{ width: `${((s.at + 1) / s.steps.length) * 100}%` }}
            />
          </div>
          <h2 id={titleId} className="m-0 text-[17px] font-semibold">
            {s.steps[s.at]!.title}
          </h2>
          <p className="m-0 text-[14px] text-muted">{s.steps[s.at]!.text}</p>
          <div className="flex items-center gap-2 pt-2">
            {s.at > 0 && (
              <Button size="sm" variant="ghost" onClick={() => useExplain.setState({ at: s.at - 1 })}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto"
              icon={
                s.playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />
              }
              onClick={() => useExplain.setState({ playing: !s.playing })}
              {...(s.at === s.steps.length - 1 && !s.playing
                ? { disabledReason: 'This is the last step.' }
                : {})}
            >
              {s.playing ? 'Pause' : 'Auto-play'}
            </Button>
            <Button
              ref={next}
              size="sm"
              variant="primary"
              onClick={() => (s.at === s.steps.length - 1 ? exit() : useExplain.setState({ at: s.at + 1 }))}
            >
              {s.at === s.steps.length - 1 ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** Header "Explain run" (SIMULATOR.md header; W09). */
export function ExplainButton() {
  return (
    <Button
      data-explain-button
      size="sm"
      variant="ghost"
      icon={<Lightbulb size={16} aria-hidden="true" />}
      onClick={() => void startExplain()}
    >
      Explain run
    </Button>
  );
}
