import { AppError, present } from '@sl/errors';
import { configOf, labelOf, spec, type PipelineNode } from '@sl/graph';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useIssues } from './issues';
import { accent, ELLIPSIS, NodeIcon, tint } from './look';

export type SlNode = Node<{ node: PipelineNode }, 'sl'>;
export const NODE_W = 184;
export const NODE_H = 64;

const EMPTY: never[] = [];
const spread = (i: number, n: number) => (n === 1 ? '50%' : `${((i + 1) / (n + 1)) * 100}%`);

/** Board B03: 184×64, radius 12, icon tile, uppercase type in the category accent, name, mono summary. */
export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<SlNode>) {
  const n = data.node;
  const s = spec(n.type);
  const cfg = configOf(n);
  const issues = useIssues((st) => st.byNode[n.id] ?? EMPTY);
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
    <div
      className={`relative flex items-center gap-2.5 rounded-lg bg-surface px-3 ${look}`}
      style={{ width: NODE_W, height: NODE_H }}
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
        <span className={`font-mono text-[10.5px] text-muted ${ELLIPSIS}`}>{s.summary(cfg)}</span>
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

      {errors.length > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-pill border-2 border-surface bg-danger-600 text-[12px] font-bold text-white"
        >
          {errors.length > 1 ? errors.length : '!'}
        </span>
      )}
    </div>
  );
});
