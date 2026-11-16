import { AppError, ErrorDialog, present } from '@sl/errors';
import { pipelineWatermark } from '@sl/engine';
import { runBlocker, validate } from '@sl/graph';
import { Button, useToast } from '@sl/ui';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useId } from 'react';
import { useIssues } from './issues';
import { dispose, runner, SPEEDS, useRun } from './run';
import { useDataDrawer } from './DataDrawer';
import { useGraph } from './store';
import { REF_CTX } from './refTables';

const time = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const n = (x: number) => x.toLocaleString('en-US');

/**
 * Run pill (SIMULATOR.md "Run states"; boards W09f idle, W09i running, W09j paused, W09k finished) and the
 * run's crash dialog (SIM-ENGINE-CRASH, WX03) and slow toast (SIM-SLOW).
 */
export function RunPill() {
  const all = useIssues((s) => s.all);
  const blocker = runBlocker(all);
  const { state, speed, stats, crash, slow, stale, staleNotice, unused } = useRun();
  const toast = useToast();
  // DATA-UPLOAD-UNUSED: one toast per Source whose upload this run could not use.
  useEffect(() => {
    if (!unused.length) return;
    for (const u of unused) {
      const p = present(new AppError('DATA-UPLOAD-UNUSED', u));
      toast({
        severity: p.severity,
        message: p.message,
        action: { label: 'Open data', onClick: () => useDataDrawer.setState({ open: true }) },
      });
    }
    useRun.setState({ unused: [] });
  }, [unused, toast]);
  const speedId = useId();

  // The worker ends when the workspace closes.
  useEffect(() => () => dispose(), []);

  useEffect(() => {
    if (slow === null) return;
    const p = present(new AppError('SIM-SLOW', { speed: `${slow}×` }));
    const i = SPEEDS.indexOf(slow as never);
    toast({
      severity: p.severity,
      message: p.message,
      // Nothing to lower at the lowest speed.
      ...(i > 0 ? { action: { label: 'Lower speed', onClick: () => runner.speed(SPEEDS[i - 1]!) } } : {}),
    });
    useRun.setState({ slow: null });
  }, [slow, toast]);

  // SIM-RUN-CHANGED: an edit (or undo/redo) during a run paused it; the next Run starts over.
  useEffect(() => {
    if (!staleNotice) return;
    // The toast's Run again can be pressed after a later edit broke the pipeline: say why nothing runs.
    const runAgain = async () => {
      if (await runner.play()) return;
      const g = useGraph.getState();
      const b = runBlocker(validate({ nodes: g.nodes, edges: g.edges }, REF_CTX));
      if (!b) return;
      const p = present(new AppError(b.code, b.params));
      toast({ severity: p.severity, message: p.message });
    };
    // Run again only when the changed pipeline can run (SIM-RUN-BLOCKED otherwise). Checked on the graph now:
    // the issues store updates after a short debounce.
    const { nodes, edges } = useGraph.getState();
    const canRun = !runBlocker(validate({ nodes, edges }, REF_CTX));
    const p = present(new AppError('SIM-RUN-CHANGED'));
    toast({
      severity: p.severity,
      message: p.message,
      ...(canRun ? { action: { label: 'Run again', onClick: () => void runAgain() } } : {}),
    });
    useRun.setState({ staleNotice: false });
  }, [staleNotice, toast]);

  const processed = stats?.processed ?? 0;
  const total = stats?.total ?? 0;
  const wm = stats ? pipelineWatermark(stats) : -Infinity;
  const errors = stats ? Object.values(stats.nodes).reduce((s, x) => s + x.failed, 0) : 0;
  const label =
    state === 'running'
      ? `Running · event ${n(processed)} of ${n(total)}`
      : state === 'paused'
        ? `Paused at event ${n(processed)}`
        : state === 'finished'
          ? `Finished · ${n(total)} events · ${n(errors)} ${errors === 1 ? 'error' : 'errors'}`
          : blocker
            ? 'Not ready'
            : 'Ready';
  // Screen readers hear state changes, not the event counter ticking 10×/s.
  const announce = state === 'running' ? 'Running' : label;
  const why = blocker ? present(new AppError(blocker.code, blocker.params)).message : undefined;

  return (
    <div className="flex items-center gap-2 rounded-pill border border-line bg-surface py-1 pr-1 pl-3.5 shadow-card">
      <span
        aria-hidden="true"
        data-run-label
        className="text-[13px] font-medium whitespace-nowrap text-muted tabular-nums"
      >
        {label}
      </span>
      <span role="status" className="sr-only">
        {announce}
      </span>
      {state === 'running' ? (
        <Button size="sm" icon={<Pause size={14} aria-hidden="true" />} onClick={runner.pause}>
          Pause
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={14} aria-hidden="true" />}
          onClick={runner.play}
          {...(why ? { disabledReason: why } : {})}
        >
          {state === 'paused' && !stale ? 'Resume' : state === 'finished' || stale ? 'Run again' : 'Run'}
        </Button>
      )}
      {(state === 'ready' || state === 'paused') && (
        <Button
          size="sm"
          variant="ghost"
          icon={<SkipForward size={14} aria-hidden="true" />}
          onClick={runner.step}
          {...(why ? { disabledReason: why } : {})}
        >
          Step
        </Button>
      )}
      {(state === 'paused' || state === 'finished') && (
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={14} aria-hidden="true" />}
          onClick={runner.reset}
        >
          Reset
        </Button>
      )}
      <div
        role="radiogroup"
        aria-label="Speed"
        className="inline-flex gap-0.5 rounded-pill border border-line bg-subtle p-0.5"
      >
        {SPEEDS.map((s) => (
          <label
            key={s}
            className={`cursor-pointer rounded-pill px-2 py-0.5 font-mono text-[12px] has-[:focus-visible]:shadow-[0_0_0_2px_var(--sl-color-rose-600)] ${s === speed ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(31,20,22,0.08)]' : 'text-muted'}`}
          >
            <input
              type="radio"
              name={speedId}
              className="sr-only"
              checked={s === speed}
              onChange={() => runner.speed(s)}
            />
            {s}×
          </label>
        ))}
      </div>
      {state !== 'ready' && Number.isFinite(wm) && (
        <span
          className="pr-2 font-mono text-[12px] text-muted"
          title="Watermark: event time the pipeline has reached"
        >
          WM {time(wm)}
        </span>
      )}
      {crash && (
        <ErrorDialog
          open
          onOpenChange={(o) => !o && runner.dismissCrash()}
          error={new AppError('SIM-ENGINE-CRASH', { n: n(crash.n), reason: crash.reason })}
          onAction={(a) => a === 'Reload simulator' && runner.dismissCrash()}
        />
      )}
    </div>
  );
}
