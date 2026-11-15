import { runToHere, type Event } from '@sl/engine';
import { AppError, ErrorBanner } from '@sl/errors';
import { configOf, labelOf, spec } from '@sl/graph';
import { EmptyState, Table, type Column } from '@sl/ui';
import { Cable } from 'lucide-react';
import { useGraph } from '../store';

const ISO = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/;
const cell = (v: Event[string]) =>
  v == null
    ? '∅'
    : typeof v === 'number'
      ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : String(v).replace(ISO, '$1');

function Events({ rows, label }: { rows: Event[]; label: string }) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!rows.length) return <p className="m-0 text-[13px] text-muted">No events.</p>;
  return (
    <Table
      dense
      label={label}
      maxHeight={240}
      rows={rows.map((r, i) => ({ r, i }))}
      rowKey={(x) => x.i}
      columns={keys.map((k): Column<{ r: Event; i: number }> => ({
        key: k,
        header: k,
        mono: true,
        align: typeof rows[0]![k] === 'number' ? 'right' : 'left',
        render: (x) => cell(x.r[k] ?? null),
      }))}
    />
  );
}

/**
 * NODE-04 live preview (board W10y): sample events before and after the node, counts per output, and state per
 * key for stateful nodes. NODE-05 "Run to here" uses the same run with more events. Recomputed on every edit.
 */
export function PreviewPanel({ nodeId, events }: { nodeId: string; events: number }) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const node = nodes.find((n) => n.id === nodeId);
  // ponytail: recomputed per render (5–50 events, microseconds); memoize if the Worker engine makes it costly.
  const p = runToHere({ nodes, edges }, nodeId, events);
  if (!node || !p) return null;
  const s = spec(node.type);
  const ports = s.outputs(configOf(node));
  const isSource = s.inputs(configOf(node)).length === 0;
  const input = Object.values(p.input).flat();
  const show = events <= 5 ? 5 : events;
  if (!isSource && !input.length)
    return (
      <EmptyState icon={Cable} title="Nothing reaches this node yet" level={3}>
        Connect it to a source to see sample events before and after it.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="m-0 flex flex-wrap gap-4 text-[13px] text-muted">
        {!isSource && (
          <span>
            In <b className="font-mono text-ink tabular-nums">{input.length}</b>
          </span>
        )}
        {ports.map((port) => (
          <span key={port.id}>
            {port.id === 'main' ? 'Out' : port.label}{' '}
            <b className="font-mono text-ink tabular-nums">{p.run.out[port.id]?.length ?? 0}</b>
            {port.id !== 'main' && ' side output'}
          </span>
        ))}
        {p.run.state && (
          <span>
            Keys <b className="font-mono text-ink tabular-nums">{p.run.state.length}</b>
          </span>
        )}
        <span>Sample of {events} events per source; same seed, same events.</span>
      </p>
      {p.run.failed > 0 && (
        <ErrorBanner
          error={
            new AppError('SIM-RUNTIME-EXPR', {
              n: p.run.failed,
              node: labelOf(node),
              reason: 'the expression could not be evaluated on these values',
            })
          }
        />
      )}
      {!isSource && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">Before</h3>
          <Events rows={input.slice(0, show)} label="Events before the node" />
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-semibold">After</h3>
        <Events rows={(p.run.out['main'] ?? []).slice(0, show)} label="Events after the node" />
      </section>
      {p.run.state && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">State per key</h3>
          <Table
            dense
            label="State per key"
            maxHeight={200}
            rows={p.run.state}
            rowKey={(r) => r.key}
            columns={[
              { key: 'key', header: 'Key', mono: true, render: (r) => r.key },
              { key: 'value', header: 'State', render: (r) => r.value },
            ]}
          />
        </section>
      )}
    </div>
  );
}
