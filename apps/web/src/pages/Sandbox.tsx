import { labelOf } from '@sl/graph';
import { AppError, present } from '@sl/errors';
import { Banner, Button, EmptyState, StatusBadge, type BadgeTone } from '@sl/ui';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect } from 'react';
import { Events } from '../sim/drawer/PreviewPanel';
import { Timeline } from '../sim/RunPanel';
import { dispose, runner, useRun } from '../sim/run';
import { SCENARIOS } from '../sim/scenarios';
import { useGraph } from '../sim/store';
import { SandboxCanvas } from '../sim/Workspace';
import { simulatorSupported } from '../support';

const STATE: Record<string, [string, BadgeTone]> = {
  ready: ['Idle', 'neutral'],
  running: ['Running', 'info'],
  paused: ['Paused', 'neutral'],
  finished: ['Finished', 'success'],
  crashed: ['Stopped', 'error'],
};

/**
 * LEARN-02 the chapter's sandbox (boards W05 idle, W05b running): the chapter's scenario in the simulator's
 * engine, read-only — Reset, Step, Run, the event-time chart and the first sink's rows. Nothing is saved
 * (it is not one of My pipelines). ponytail: the board's Window size / Allowed lateness controls wait for the
 * chapter text (each chapter names the knobs it needs).
 */
export function Sandbox(props: { chapter: string; scenario: string }) {
  // BROWSER-UNSUPPORTED: the chapter still reads; the sandbox says why it is not there.
  if (!simulatorSupported())
    return <Banner severity="error">{present(new AppError('BROWSER-UNSUPPORTED')).message}</Banner>;
  return <SandboxBox {...props} />;
}

function SandboxBox({ chapter, scenario }: { chapter: string; scenario: string }) {
  const state = useRun((s) => s.state);
  const stats = useRun((s) => s.stats);
  const crash = useRun((s) => s.crash);
  const sink = useGraph((g) => g.nodes.find((n) => n.type === 'Sink'));
  useEffect(() => {
    const s = SCENARIOS.find((x) => x.title === scenario);
    if (!s) return;
    // Its own speed (1×) and its own run: the simulator's speed and any crash are put back / cleared on leaving.
    const speed = useRun.getState().speed;
    runner.reset();
    runner.speed(1);
    useGraph.getState().load({ id: `sandbox-${chapter}`, name: s.title, ...s.build() });
    return () => {
      dispose(); // stops the worker: a run left playing would keep going in the background
      useRun.setState({ crash: null, speed });
    };
  }, [chapter, scenario]);
  const [label, tone] = STATE[state] ?? ['Idle', 'neutral'];
  const rows = (sink && stats?.outputs[sink.id]) ?? [];
  return (
    <section
      aria-labelledby="sandbox-title"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
    >
      <div className="flex items-center gap-3">
        <h2 id="sandbox-title" className="m-0 text-[18px] font-semibold">
          Sandbox
        </h2>
        <StatusBadge tone={tone}>{label}</StatusBadge>
        <span className="ml-auto" />
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={16} aria-hidden="true" />}
          onClick={() => {
            runner.pause(); // a playing run stops, not just its display
            runner.reset();
            useRun.setState({ crash: null });
          }}
          aria-label="Reset sandbox"
        >
          Reset
        </Button>
        <Button
          size="sm"
          icon={<SkipForward size={16} aria-hidden="true" />}
          onClick={() => void runner.step()}
          {...(state === 'running' ? { disabledReason: 'Pause the run to step through it.' } : {})}
        >
          Step
        </Button>
        {state === 'running' ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Pause size={16} aria-hidden="true" />}
            onClick={runner.pause}
          >
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={16} aria-hidden="true" />}
            onClick={() => void runner.play()}
          >
            Run
          </Button>
        )}
      </div>
      <div className="h-[220px]">
        <SandboxCanvas />
      </div>
      <h3 className="m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Event time</h3>
      <div className="h-[160px]">
        <Timeline stats={stats} />
      </div>
      {crash && (
        // SIM-ENGINE-CRASH, here as a banner: the sandbox has no dialog of its own; Reset starts over.
        <Banner severity="error">
          {present(new AppError('SIM-ENGINE-CRASH', { n: crash.n, reason: crash.reason })).message} Press
          Reset to start again.
        </Banner>
      )}
      {state === 'ready' ? (
        <EmptyState icon={Play} title="Press Run to start" level={3}>
          Events will flow from the source, and each window fires when the watermark passes its end.
        </EmptyState>
      ) : (
        <Events rows={rows} label={sink ? `Output of ${labelOf(sink)}` : 'Output'} empty="No rows yet." />
      )}
    </section>
  );
}
