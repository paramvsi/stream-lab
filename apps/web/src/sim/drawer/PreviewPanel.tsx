import { runToHere, type Event } from '@sl/engine';
import { configOf, effectiveGenerator, spec } from '@sl/graph';
import { EmptyState, Table, type Column } from '@sl/ui';
import { Cable } from 'lucide-react';
import { useEffect, useState } from 'react';
import { uploadedRows } from '../run';
import { useGraph } from '../store';
import { useRefTables } from '../refTables';

const ISO = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/;
const cell = (v: Event[string]) =>
  v == null
    ? '∅'
    : typeof v === 'number'
      ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : String(v).replace(ISO, '$1');

export function Events({
  rows,
  label,
  empty = 'No events.',
  arrive = false,
}: {
  rows: Event[];
  label: string;
  empty?: string;
  /** WM01: new rows drop in (rows are keyed by position, so only appended rows mount and animate). */
  arrive?: boolean;
}) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // WM01: rows there when the table mounted (tab switch, drawer closed) stay still; only later ones drop in.
  const [mounted] = useState(rows.length);
  if (!rows.length) return <p className="m-0 text-[13px] text-muted">{empty}</p>;
  return (
    <Table
      dense
      label={label}
      maxHeight={240}
      rows={rows.map((r, i) => ({ r, i }))}
      rowKey={(x) => x.i}
      {...(arrive ? { rowClassName: (x: { i: number }) => (x.i >= mounted ? 'sl-row-arrive' : '') } : {})}
      columns={keys.map((k): Column<{ r: Event; i: number }> => ({
        key: k,
        header: k,
        mono: true,
        // Align by the first value that is there (a left-join miss leaves nulls).
        align: typeof rows.find((r) => r[k] != null)?.[k] === 'number' ? 'right' : 'left',
        render: (x) => cell(x.r[k] ?? null),
      }))}
    />
  );
}

const Count = ({ label, n, after }: { label: string; n: number; after?: string }) => (
  <span>
    {label} <b className="font-mono text-ink tabular-nums">{n}</b>
    {after}
  </span>
);

/**
 * NODE-04 live preview (board W10y): the engine on sample events, tapped at this node — events before and after,
 * counts per output, and open state per key for stateful nodes. NODE-05 "Run to here" uses more events.
 * `compact`: the short version under the Settings form (NODES.md "form + live preview", boards W10-*).
 */
export function PreviewPanel({
  nodeId,
  events,
  compact,
}: {
  nodeId: string;
  events: number;
  compact?: boolean;
}) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const node = nodes.find((n) => n.id === nodeId);
  // ponytail: recomputed per render (audit 3 measured 0.5–2 ms for a 20-node chain); memoize if it grows.
  const seed = useGraph((s) => s.seed);
  const refTables = useRefTables((s) => s.user);
  const stored = useGraph((s) => s.data.generator);
  const uploads = useGraph((s) => s.data.uploads);
  const pipelineId = useGraph((s) => s.pipelineId);
  // Uploaded rows (OPFS, async) so the preview shows what a run would read (DATA-02).
  const [sourceData, setSourceData] = useState<Record<string, Event[]>>({});
  useEffect(() => {
    let live = true;
    const g = useGraph.getState();
    void uploadedRows(pipelineId, g.nodes, g.data, events).then((r) => live && setSourceData(r.sourceData));
    return () => {
      live = false;
    };
  }, [pipelineId, uploads, events]);
  const p = runToHere({ nodes, edges }, nodeId, events, {
    seed,
    generator: effectiveGenerator(stored, seed),
    sourceData,
    refTables,
  });
  if (!node || !p) return null;
  const s = spec(node.type);
  const ports = s.outputs(configOf(node));
  const isSource = s.inputs(configOf(node)).length === 0;
  const connected = edges.some((e) => e.target === nodeId);
  const input = Object.values(p.input).flat();
  const after = p.out['main'] ?? [];
  if (!isSource && !connected)
    return (
      <EmptyState icon={Cable} title="Nothing connected yet" level={3}>
        Connect this node to a source to see sample events before and after it.
      </EmptyState>
    );
  if (compact)
    return (
      <section aria-label="Live preview" className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="m-0 text-[13px] font-semibold">
          Live preview{' '}
          <span className="font-normal text-muted">
            · {Math.min(3, after.length)} of {after.length} rows
          </span>
        </h3>
        <p aria-live="polite" className="m-0 text-[13px] text-muted">
          {isSource
            ? `${after.length} sample events`
            : `${after.length} of ${input.length} sample events pass`}
          {p.failed > 0 && `, ${p.failed} failed`}.
        </p>
        <Events rows={after.slice(0, 3)} label="Live preview" empty="No rows come out of this sample yet." />
      </section>
    );
  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="m-0 flex flex-wrap gap-4 text-[13px] text-muted">
        {!isSource && <Count label="In" n={input.length} />}
        {ports.map((port) => (
          <Count
            key={port.id}
            label={port.id === 'main' ? 'Out' : port.label}
            n={p.out[port.id]?.length ?? 0}
            {...(port.id !== 'main' ? { after: ' side output' } : {})}
          />
        ))}
        {p.failed > 0 && (
          <Count label="Failed" n={p.failed} after=" (expression errors, kept as dead letters)" />
        )}
        {p.state && <Count label={node.type === 'Window' ? 'Open windows' : 'Keys'} n={p.state.length} />}
        <span>Sample of {events} events per source; same seed, same events.</span>
      </p>
      {!isSource && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">Before</h3>
          <Events
            rows={input.slice(0, events)}
            label="Events before the node"
            empty="No events from upstream in this sample."
          />
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-semibold">After</h3>
        <Events rows={after.slice(0, events)} label="Events after the node" />
      </section>
      {p.state && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">
            State per key{node.type === 'Window' ? ' (open windows)' : ''}
          </h3>
          <Events rows={p.state} label="State per key" empty="Nothing held in state." />
        </section>
      )}
    </div>
  );
}
