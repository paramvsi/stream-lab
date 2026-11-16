import type { RunStats, TimelineEntry } from '@sl/engine';
import { AppError, toProblems } from '@sl/errors';
import { labelOf, runBlocker } from '@sl/graph';
import { EmptyState, ProblemsPanel, Tabs } from '@sl/ui';
import { useReactFlow } from '@xyflow/react';
import { Activity, Code2, Route as RouteIcon, Table2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Events } from './drawer/PreviewPanel';
import { useIssues } from './issues';
import { fmt, useRun } from './run';
import { useGraph } from './store';

/** SIMULATOR.md: one bottom drawer — node config or run panel. True while the node drawer is open. */
export const useBottomDrawer = create<{ node: boolean }>(() => ({ node: false }));

const RUN_DEAD = '__run_dead_letters';
const W = 640;
const H = 150;
const hms = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/**
 * SIM-21 Timeline: event time (up) against the run's clock (across). Grey dots are sampled events, the rose line
 * is the watermark, rose ticks are window fires, orange dots are late events. A text summary follows for screen
 * readers (the chart is never the only carrier).
 */
function Timeline({ stats }: { stats: RunStats | null }) {
  const t = stats?.timeline ?? [];
  if (!t.length)
    return (
      <EmptyState icon={Activity} title="Run the pipeline to see its timeline" level={3}>
        Event time against the run&rsquo;s clock: the watermark, window fires and late events.
      </EmptyState>
    );
  const ys = t.map((e) => e.ts).filter(Number.isFinite);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys, y0 + 1);
  const x1 = Math.max(stats!.now, 1);
  const px = (e: TimelineEntry) => 8 + (e.at / x1) * (W - 16);
  const py = (ts: number) => H - 8 - ((ts - y0) / (y1 - y0)) * (H - 16);
  const wm = t.filter((e) => e.kind === 'watermark');
  const fires = t.filter((e) => e.kind === 'fire');
  const late = t.filter((e) => e.kind === 'late');
  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[150px] w-full max-w-[900px] rounded-md border border-line bg-surface"
        role="img"
        aria-label="Timeline chart"
      >
        {t
          .filter((e) => e.kind === 'event')
          .map((e, i) => (
            <circle key={`e${i}`} cx={px(e)} cy={py(e.ts)} r={1.6} fill="var(--sl-color-line-strong)" />
          ))}
        <polyline
          fill="none"
          stroke="var(--sl-color-rose-600)"
          strokeWidth={1.5}
          points={wm.map((e) => `${px(e)},${py(e.ts)}`).join(' ')}
        />
        {fires.map((e, i) => (
          <line
            key={`f${i}`}
            x1={px(e)}
            x2={px(e)}
            y1={py(e.ts) - 4}
            y2={py(e.ts) + 4}
            stroke="var(--sl-color-rose-700)"
            strokeWidth={1.5}
          />
        ))}
        {late.map((e, i) => (
          <circle key={`l${i}`} cx={px(e)} cy={py(e.ts)} r={2.6} fill="var(--sl-color-orange-700)" />
        ))}
      </svg>
      <p className="m-0 text-[13px] text-muted">
        Watermark {wm.length ? hms(wm.at(-1)!.ts) : '—'} · {fmt(fires.length)} window fires ·{' '}
        {fmt(late.length)} late events · grey dots are sampled events, the rose line is the watermark.
      </p>
    </div>
  );
}

function Output({ stats }: { stats: RunStats | null }) {
  // Select the stable array, filter after (a filtering selector returns a new array each time and loops).
  const nodes = useGraph((s) => s.nodes);
  // With no enabled Dead-letter node, the run's own dead letters (failed expressions) are listed here, so
  // SIM-RUNTIME-EXPR's "They were sent to Dead-letter" stays true.
  const hasDlq = nodes.some((n) => n.type === 'Dead-letter' && !n.disabled);
  const runDead = !hasDlq && (stats?.deadLetter.length ?? 0) > 0;
  const sinks = [
    ...nodes.filter((n) => n.type === 'Sink' || n.type === 'Dead-letter'),
    ...(runDead
      ? [
          {
            id: RUN_DEAD,
            type: 'Dead-letter' as const,
            label: 'Dead letters (failed expressions)',
            position: { x: 0, y: 0 },
            config: {},
          },
        ]
      : []),
  ];
  const [pick, setPick] = useState<string | null>(null);
  const current = sinks.find((n) => n.id === pick) ?? sinks.find((n) => n.type === 'Sink') ?? sinks[0];
  if (!stats || !current)
    return (
      <EmptyState
        icon={Table2}
        title={current ? 'Run the pipeline to see its output' : 'No sink yet'}
        level={3}
      >
        {current ? 'What reaches each sink shows here.' : 'Add a Sink to collect results.'}
      </EmptyState>
    );
  const rowsOf = (id: string) =>
    id === RUN_DEAD
      ? stats.deadLetter.map((d) => ({ ...d.data, reason: d.reason }))
      : (stats.outputs[id] ?? []);
  const rows = rowsOf(current.id);
  return (
    <div className="flex flex-col gap-2">
      {sinks.length > 1 && (
        <label className="flex items-center gap-2 text-[13px] font-medium">
          Sink
          <select
            className="sl-focus min-h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]"
            value={current.id}
            onChange={(e) => setPick(e.target.value)}
          >
            {sinks.map((n) => (
              <option key={n.id} value={n.id}>
                {labelOf(n)} ({fmt(rowsOf(n.id).length)})
              </option>
            ))}
          </select>
        </label>
      )}
      <Events
        key={current.id}
        arrive
        rows={rows}
        label={`Output of ${labelOf(current)}`}
        empty="Nothing reached this sink."
      />
    </div>
  );
}

function ProblemsList() {
  const all = useIssues((s) => s.all);
  const nodes = useGraph((s) => s.nodes);
  const rf = useReactFlow();
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const problems = toProblems(
    all.map((i, k) => ({
      id: `${i.code}-${i.nodeId ?? 'graph'}-${k}`,
      error: new AppError(i.code, i.params),
      location:
        i.nodeId && byId.get(i.nodeId)
          ? `${byId.get(i.nodeId)!.type} · ${labelOf(byId.get(i.nodeId)!)}`
          : 'Pipeline',
    })),
  );
  return (
    <ProblemsPanel
      problems={problems}
      filter={filter}
      onFilterChange={setFilter}
      onSelect={(p) => {
        // Clicking a problem selects its node (SIM-14) and brings it into view.
        const issue = all.find((i, k) => `${i.code}-${i.nodeId ?? 'graph'}-${k}` === p.id);
        if (!issue?.nodeId) return;
        useGraph.getState().select([issue.nodeId]);
        void rf.fitView({ nodes: [{ id: issue.nodeId }], duration: 300, maxZoom: 1.2 });
      }}
    />
  );
}

/**
 * SIM-21 run panel (SIMULATOR.md: bottom drawer 250 px; boards W09i–k): Timeline, Output, Trace, Flink SQL,
 * Problems. A finished run opens the Output tab.
 */
export function RunPanel() {
  const stats = useRun((s) => s.stats);
  const issues = useIssues((s) => s.all.length);
  const [tab, setTab] = useState('problems');
  const nodeDrawer = useBottomDrawer((s) => s.node);
  const panel = useRef<HTMLElement>(null);
  // Automatic switches never pull the keyboard out from under the user: if focus is in the panel, stay.
  const switchTo = (t: string) => {
    if (panel.current?.contains(document.activeElement)) return;
    setTab(t);
  };
  const switchRef = useRef(switchTo);
  useEffect(() => {
    switchRef.current = switchTo;
  });
  useEffect(
    () =>
      useRun.subscribe((s, prev) => {
        if (s.state === 'finished' && prev.state !== 'finished') switchRef.current('output');
        else if (s.state === 'running' && prev.state === 'ready') switchRef.current('timeline');
      }),
    [],
  );
  // SIM-RUN-BLOCKED: "Problems tab opens" when the pipeline stops being runnable.
  useEffect(
    () =>
      useIssues.subscribe((s, prev) => {
        if (runBlocker(s.all) && !runBlocker(prev.all)) switchRef.current('problems');
      }),
    [],
  );
  const outCount = stats
    ? useGraph
        .getState()
        .nodes.filter((n) => n.type === 'Sink')
        .reduce((a, n) => a + (stats.outputs[n.id]?.length ?? 0), 0)
    : undefined;
  if (nodeDrawer) return null;
  return (
    <section
      ref={panel}
      aria-label="Run panel"
      className="h-[250px] shrink-0 overflow-y-auto border-t border-line bg-surface px-4"
    >
      <Tabs
        label="Run panel"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'timeline', label: 'Timeline', content: <Timeline stats={stats} /> },
          {
            value: 'output',
            label: 'Output',
            ...(outCount !== undefined ? { count: outCount } : {}),
            content: <Output stats={stats} />,
          },
          {
            value: 'trace',
            label: 'Trace',
            content: (
              <EmptyState icon={RouteIcon} title="Tracing an event is not available yet" level={3}>
                It arrives with Explain this run, which follows one event through every node.
              </EmptyState>
            ),
          },
          {
            value: 'sql',
            label: 'Flink SQL',
            content: (
              <EmptyState icon={Code2} title="Flink SQL is not available yet" level={3}>
                It arrives with Export, which turns this pipeline into Flink SQL.
              </EmptyState>
            ),
          },
          { value: 'problems', label: 'Problems', count: issues, content: <ProblemsList /> },
        ]}
      />
    </section>
  );
}
