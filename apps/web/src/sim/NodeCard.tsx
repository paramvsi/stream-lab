import { useExplainStep } from './ExplainCard';
import { AppError, present } from '@sl/errors';
import { configOf, labelOf, spec, type PipelineNode } from '@sl/graph';
import { Button } from '@sl/ui';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Cable, Copy, Play, Power, Settings2, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useNodeActions } from './CanvasExtras';
import { useIssues } from './issues';
import {
  fmt,
  useIsBusiest,
  useNodeFires,
  useNodeLate,
  useNodeCounts,
  useNodeFailed,
  useNodeFailReason,
} from './run';
import { useGraph } from './store';
import { accent, ELLIPSIS, NodeIcon, tint } from './look';

export type SlNode = Node<{ node: PipelineNode }, 'sl'>;
export const NODE_W = 184;
export const NODE_H = 64;

const EMPTY: never[] = [];
const spread = (i: number, n: number) => (n === 1 ? '50%' : `${((i + 1) / (n + 1)) * 100}%`);

/** Board B03: 184×64, radius 12, icon tile, uppercase type in the category accent, name, mono summary. */
export const NodeCard = memo(function NodeCard({ data, selected, dragging }: NodeProps<SlNode>) {
  const n = data.node;
  const s = spec(n.type);
  const cfg = configOf(n);
  const issues = useIssues((st) => st.byNode[n.id] ?? EMPTY);
  const kind = s.inputs(cfg).length === 0 ? 'source' : s.outputs(cfg).length === 0 ? 'sink' : 'node';
  const counts = useNodeCounts(
    n.id,
    kind,
    s
      .outputs(cfg)
      .filter((p) => p.kind === 'main')
      .map((p) => p.id)
      .join(','),
  );
  const failed = useNodeFailed(n.id);
  const failReason = useNodeFailReason(n.id);
  const busiest = useIsBusiest(n.id);
  // EXPL-02: while explaining, nodes off the path dim to 35% and path nodes carry their step number.
  const explainStep = useExplainStep(n.id);
  const fires = useNodeFires(n.id);
  const late = useNodeLate(n.id);
  const single = useGraph((st) => st.selected.length === 1);
  const shown = issues.map((i) => present(new AppError(i.code, i.params)));
  const errors = shown.filter((p) => p.severity === 'error');
  const c = s.category;
  const ins = s.inputs(cfg);
  const outs = s.outputs(cfg);
  const mainOuts = outs.filter((p) => p.kind === 'main');
  const sideOuts = outs.filter((p) => p.kind === 'side');

  const look = n.disabled
    ? 'border-[1.5px] border-dashed border-line-strong opacity-55'
    : errors.length
      ? 'border-[1.5px] border-danger-600 shadow-[0_0_0_4px_var(--sl-color-danger-50)]'
      : selected
        ? 'border-[1.5px] border-rose-600 shadow-[0_0_0_4px_var(--sl-color-rose-100),var(--sl-shadow-card)]'
        : 'border border-line';

  return (
    <>
      {/* SIM-10: single selection only, hidden while dragging. */}
      <NodeToolbar isVisible={selected && single && !dragging} offset={10}>
        <Toolbar node={n} />
      </NodeToolbar>
      <div
        className={`relative flex items-center gap-2.5 rounded-lg bg-surface px-3 ${look} ${busiest ? 'sl-glow' : ''}`}
        style={{ width: NODE_W, height: NODE_H, ...(explainStep === null ? { opacity: 0.35 } : {}) }}
        title={shown.map((p) => p.message).join('\n') || undefined}
      >
        <span
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: tint(c) }}
        >
          <NodeIcon type={n.type} color={accent(c)} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className="text-[10.5px] font-semibold tracking-[0.04em] uppercase"
            style={{ color: accent(c) }}
          >
            {n.type}
            {n.disabled && <span className="text-muted normal-case"> · disabled</span>}
          </span>
          <span className={`text-[13.5px] font-semibold text-ink ${ELLIPSIS}`}>{labelOf(n)}</span>
          {/* SIM-17: live counts replace the summary while a run exists (board W09i). */}
          <span className={`font-mono text-[10.5px] text-muted tabular-nums ${ELLIPSIS}`}>
            {counts ?? s.summary(cfg)}
          </span>
        </span>
        {/* Screen readers: the problems in words (never colour alone). */}
        {shown.length > 0 && (
          <span className="sr-only">
            {shown.length} problem{shown.length > 1 ? 's' : ''}: {shown.map((p) => p.message).join(' ')}
          </span>
        )}

        {ins.map((p, i) => (
          <Handle
            key={p.id}
            id={p.id}
            type="target"
            position={Position.Left}
            title={`${p.label} input`}
            style={{ top: spread(i, ins.length) }}
            className="sl-handle"
          />
        ))}
        {mainOuts.map((p, i) => (
          <Handle
            key={p.id}
            id={p.id}
            type="source"
            position={Position.Right}
            title={`${p.label} output`}
            style={{ top: spread(i, mainOuts.length) }}
            className="sl-handle"
          />
        ))}
        {sideOuts.map((p, i) => (
          <Handle
            key={p.id}
            id={p.id}
            type="source"
            position={Position.Bottom}
            title={`${p.label} output`}
            style={{ left: spread(i, sideOuts.length) }}
            className={`sl-handle sl-handle-side sl-handle-${p.id}`}
          />
        ))}

        {/* SIM-18: events whose expression failed in this run (SIM-RUNTIME-EXPR), as a count with words. */}
        {failed > 0 && <FailedBadge n={failed} node={labelOf(n)} reason={failReason} />}
        {busiest && <span className="sr-only">Busiest node right now.</span>}
        {typeof explainStep === 'number' && (
          <span className="absolute -top-2.5 -left-2.5 flex size-6 items-center justify-center rounded-full bg-rose-600 font-mono text-[12px] font-semibold text-white">
            <span className="sr-only">Explain step </span>
            {explainStep}
          </span>
        )}
        {/* WM01: a window flashes when it fires; WM02: a late event drops to the late port. Decorative (the counts
            say it in words); off under reduced motion via tokens.css. */}
        {n.type === 'Window' && !n.disabled && fires > 0 && (
          <span key={`f${fires}`} aria-hidden="true" className="sl-fire" />
        )}
        {late > 0 && (
          <span
            key={`l${late}`}
            aria-hidden="true"
            className="sl-late-dot"
            style={{
              left: spread(
                sideOuts.findIndex((p) => p.id === 'late'),
                sideOuts.length,
              ),
            }}
          />
        )}
        {errors.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-pill border-2 border-surface bg-danger-600 text-[12px] font-bold text-white"
          >
            {errors.length > 1 ? errors.length : '!'}
          </span>
        )}
      </div>
    </>
  );
});

/** Board W09g toolbar: Configure, Run to here, Duplicate, Disable, Connect to…, Delete. */
function Toolbar({ node }: { node: PipelineNode }) {
  const a = useNodeActions();
  const g = useGraph.getState;
  const hasOut = spec(node.type).outputs(configOf(node)).length > 0;
  const btn = 'nodrag nopan !h-8 !min-h-8 !px-2';
  return (
    <div
      role="toolbar"
      aria-label={`${labelOf(node)} actions`}
      className="flex gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-card"
    >
      <Button
        size="sm"
        variant="ghost"
        className={btn}
        aria-label="Configure"
        onClick={() => a.configure(node.id)}
      >
        <Settings2 size={16} aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={btn}
        aria-label="Run to here"
        onClick={() => a.runToHere(node.id)}
      >
        <Play size={16} aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={btn}
        aria-label="Duplicate"
        onClick={() => g().duplicate([node.id])}
      >
        <Copy size={16} aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={btn}
        aria-label={node.disabled ? 'Enable' : 'Disable'}
        aria-pressed={node.disabled ?? false}
        onClick={() => g().toggleDisabled([node.id])}
      >
        <Power size={16} aria-hidden="true" />
      </Button>
      {hasOut && (
        <Button
          size="sm"
          variant="ghost"
          className={btn}
          aria-label="Connect to…"
          onClick={() => a.connectFrom(node.id)}
        >
          <Cable size={16} aria-hidden="true" />
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className={btn}
        aria-label="Delete"
        onClick={() => a.remove([node.id])}
      >
        <Trash2 size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * SIM-18 badge: the count of events whose expression failed, with an icon (never colour alone); the words come from
 * the catalog (SIM-RUNTIME-EXPR) for screen readers and the tooltip.
 */
function FailedBadge({ n, node, reason }: { n: number; node: string; reason: string }) {
  const words = present(
    new AppError('SIM-RUNTIME-EXPR', { n: fmt(n), node, reason: reason || 'the expression failed' }),
  ).message;
  return (
    <span
      className="absolute -top-2 -left-2 flex h-5 items-center gap-0.5 rounded-pill border-2 border-surface bg-orange-700 px-1 text-[11px] font-bold text-white"
      title={words}
    >
      <AlertTriangle size={10} aria-hidden="true" />
      <span aria-hidden="true">{fmt(n)}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}
