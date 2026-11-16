import { MAX_PARALLELISM } from '@sl/engine';
import { Table } from '@sl/ui';
import { useRun } from '../run';

const n = (x: number) => x.toLocaleString('en-US');

/**
 * ENG-03 stage inspector: how a keyed node's events spread over the simulated subtasks. Each key's hash picks
 * one of 128 key groups (max parallelism), and each subtask owns a range of key groups — the same assignment
 * Flink's KeyGroupRangeAssignment makes, so a skewed key shows as a busy subtask.
 */
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
        {p} subtasks share {MAX_PARALLELISM} key groups: subtask <i>s</i> owns groups{' '}
        <span className="font-mono">s × {MAX_PARALLELISM / p}</span> to{' '}
        <span className="font-mono">(s + 1) × {MAX_PARALLELISM / p} − 1</span>. A key always lands on the same
        one.
      </p>
      <Table
        dense
        label="Events per subtask"
        rows={st.subtasks.map((events, i) => ({ i, events }))}
        rowKey={(r) => r.i}
        columns={[
          { key: 'sub', header: 'Subtask', mono: true, render: (r) => r.i },
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
            { key: 'key', header: 'Key', mono: true, render: (r) => r.key || '∅' },
            { key: 'group', header: 'Key group', mono: true, align: 'right', render: (r) => r.keyGroup },
            { key: 'sub', header: 'Subtask', mono: true, align: 'right', render: (r) => r.subtask },
            { key: 'events', header: 'Events', mono: true, align: 'right', render: (r) => n(r.events) },
          ]}
        />
      )}
    </section>
  );
}
