import { MAX_PARALLELISM } from '@sl/engine';
import { configOf, type PipelineNode } from '@sl/graph';
import { Table } from '@sl/ui';
import { useEffect } from 'react';
import { runner, useRun } from '../run';
import { Events } from './PreviewPanel';

const n = (x: number) => x.toLocaleString('en-US');

/**
 * ENG-03 stage inspector: how a keyed node's events spread over the simulated subtasks. Each key's hash picks
 * one of 128 key groups (max parallelism), and each subtask owns a range of key groups — the same assignment
 * Flink's KeyGroupRangeAssignment makes, so a skewed key shows as a busy subtask.
 */
/**
 * EXPL-06 stage inspector: this node in the run — in, out per port, failed, late and dropped (what came in and
 * left nowhere; not for nodes that aggregate or hold events back) — and its open state per key while the run is
 * paused or finished (asked of the run, not streamed: it can be big).
 */
// No "Dropped" where in ≠ out by design: nodes that hold or aggregate, and the ends (a Sink writes what it gets).
const NO_DROPPED = new Set([
  'Window',
  'Top-N',
  'Join',
  'Pattern',
  'Sink',
  'Dead-letter',
  'Source',
  'Generator',
]);
function portName(node: PipelineNode, port: string) {
  if (port === 'main') return 'Out';
  if (port === 'default') return 'Default branch';
  if (port === 'rejected') return 'Rejected';
  if (port === 'dead-letter') return 'Dead letters';
  const routes = (configOf(node) as { routes?: { id: string; name: string }[] }).routes ?? [];
  return routes.find((r) => `route-${r.id}` === port)?.name ?? port;
}
export function RunCounts({ node }: { node: PipelineNode }) {
  const nodeId = node.id;
  const type = node.type;
  const st = useRun((s) => (s.state !== 'ready' ? s.stats?.nodes[nodeId] : undefined));
  const state = useRun((s) => s.state);
  const processed = useRun((s) => s.stats?.processed ?? 0);
  const rows = useRun((s) => s.snapshots[nodeId]);
  const still = state === 'paused' || state === 'finished';
  useEffect(() => {
    if (still) runner.snapshot(nodeId);
  }, [still, processed, nodeId]);
  if (!st) return null;
  // Late leaves on a 'late' port too; it is shown once, as Late.
  const outs = Object.entries(st.out).filter(([port]) => port !== 'late');
  const left = outs.reduce((a, [, v]) => a + v, 0) + st.failed + st.late;
  const dropped = Math.max(0, st.in - left);
  return (
    <section aria-label="This node in the run" className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="m-0 text-[13px] font-semibold">This node in the run</h3>
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        {type !== 'Source' && type !== 'Generator' && (
          <span>
            In <b className="font-mono text-ink tabular-nums">{n(st.in)}</b>
          </span>
        )}
        {outs.map(([port, v]) => (
          <span key={port}>
            {portName(node, port)} <b className="font-mono text-ink tabular-nums">{n(v)}</b>
          </span>
        ))}
        <span>
          Failed <b className="font-mono text-ink tabular-nums">{n(st.failed)}</b>
        </span>
        <span>
          Late <b className="font-mono text-ink tabular-nums">{n(st.late)}</b>
        </span>
        {!NO_DROPPED.has(type) && (
          <span>
            Dropped <b className="font-mono text-ink tabular-nums">{n(dropped)}</b>
          </span>
        )}
      </p>
      {still && rows && rows.length > 0 && <Events rows={rows} label="State per key in the run" />}
      {still && rows && rows.length === 0 && (
        <p className="m-0 text-[13px] text-muted">No state is open for this node at this point of the run.</p>
      )}
      {!still && <p className="m-0 text-[13px] text-muted">Pause the run to see its state per key.</p>}
    </section>
  );
}

export function StageInspector({ nodeId }: { nodeId: string }) {
  const st = useRun((s) => (s.state !== 'ready' ? s.stats?.nodes[nodeId] : undefined));
  if (!st?.subtasks) return null;
  const total = st.subtasks.reduce((a, b) => a + b, 0) || 1;
  const p = st.subtasks.length;
  const keys = st.keyRouting ?? [];
  return (
    <section aria-label="Subtasks" className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="m-0 text-[13px] font-semibold">Subtasks in this run</h3>
      <p className="m-0 text-[13px] text-muted">
        {p} subtasks share {MAX_PARALLELISM} key groups; each owns the range shown. A key always lands on the
        same subtask.
      </p>
      <Table
        dense
        label="Events per subtask"
        rows={st.subtasks.map((events, i) => ({ i, events }))}
        rowKey={(r) => r.i}
        columns={[
          { key: 'sub', header: 'Subtask', mono: true, render: (r) => r.i },
          // FLINK: KeyGroupRangeAssignment — subtask s owns groups ⌈s·128/p⌉ … ⌈(s+1)·128/p⌉ − 1.
          {
            key: 'groups',
            header: 'Key groups',
            mono: true,
            render: (r) =>
              `${Math.ceil((r.i * MAX_PARALLELISM) / p)}–${Math.ceil(((r.i + 1) * MAX_PARALLELISM) / p) - 1}`,
          },
          { key: 'events', header: 'Events', mono: true, align: 'right', render: (r) => n(r.events) },
          {
            key: 'share',
            header: 'Share',
            mono: true,
            align: 'right',
            render: (r) => `${Math.round((r.events / total) * 100)} %`,
          },
        ]}
      />
      {keys.length > 0 && (
        <Table
          dense
          label="Busiest keys and their subtask"
          maxHeight={200}
          rows={keys}
          rowKey={(r) => r.key}
          columns={[
            // An empty value shows as "" (∅ is a NULL key; "(all events)" an operator that is not keyed).
            { key: 'key', header: 'Key', mono: true, render: (r) => (r.key === '' ? '""' : r.key) },
            {
              key: 'group',
              header: 'Key group',
              mono: true,
              align: 'right',
              render: (r) => (r.keyGroup < 0 ? '—' : r.keyGroup),
            },
            { key: 'sub', header: 'Subtask', mono: true, align: 'right', render: (r) => r.subtask },
            { key: 'events', header: 'Events', mono: true, align: 'right', render: (r) => n(r.events) },
          ]}
        />
      )}
    </section>
  );
}
