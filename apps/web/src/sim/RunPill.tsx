import { AppError, ErrorDialog, present } from '@sl/errors';
import { runBlocker } from '@sl/graph';
import { Button, useToast } from '@sl/ui';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useId } from 'react';
import { useIssues } from './issues';
import { dispose, runner, SPEEDS, useRun } from './run';

const time = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const n = (x: number) => x.toLocaleString('en-US');

/**
 * Run pill (SIMULATOR.md "Run states"; boards W09f idle, W09i running, W09j paused, W09k finished) and the
 * run's crash dialog (SIM-ENGINE-CRASH, WX03) and slow toast (SIM-SLOW).
 */
export function RunPill() {
  const all = useIssues((s) => s.all);
  const blocker = runBlocker(all);
  const { state, speed, stats, crash, slow } = useRun();
  const toast = useToast();
  const speedId = useId();

  // The worker ends when the workspace closes.
  useEffect(() => () => dispose(), []);

  useEffect(() => {
    if (slow === null) return;
    const p = present(new AppError('SIM-SLOW', { speed: `${slow}×` }));
    toast({
      severity: p.severity,
      message: p.message,
      action: {
        label: 'Lower speed',
        onClick: () => runner.speed(SPEEDS[Math.max(0, SPEEDS.indexOf(slow as never) - 1)]!),
      },
    });
    useRun.setState({ slow: null });
  }, [slow, toast]);

  const processed = stats?.processed ?? 0;
  const total = stats?.total ?? 0;
  const wm = stats ? Math.min(...Object.values(stats.nodes).map((x) => x.watermark)) : -Infinity;
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
  const why = blocker ? present(new AppError(blocker.code, blocker.params)).message : undefined;

  return (
    <div className="flex items-center gap-2 rounded-pill border border-line bg-surface py-1 pr-1 pl-3.5 shadow-card">
      <span role="status" className="text-[13px] font-medium whitespace-nowrap text-muted tabular-nums">
        {label}
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
          {state === 'paused' ? 'Resume' : state === 'finished' ? 'Run again' : 'Run'}
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
