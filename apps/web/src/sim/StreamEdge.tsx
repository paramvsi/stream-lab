import { AppError, present } from '@sl/errors';
import { connectionIssue, type Schema } from '@sl/graph';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useConnection,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Plus } from 'lucide-react';
import { createContext, memo, useContext, useEffect, useState } from 'react';
import { useGraph } from './store';

export type SlEdge = Edge<{ schema: Schema }, 'stream'>;

/** Canvas callbacks for edges, passed by context so edge data stays plain (no functions in state). */
export const EdgeActions = createContext<{ insertAt: (edgeId: string, x: number, y: number) => void }>({
  insertAt: () => {},
});

/** SIM-09 "+" at the midpoint on hover; SIM-25 the schema on hover. */
export const StreamEdge = memo(function StreamEdge(p: EdgeProps<SlEdge>) {
  const [path, lx, ly] = getBezierPath(p);
  const { insertAt } = useContext(EdgeActions);
  const fields = p.data?.schema.map((f) => `${f.name}: ${f.type}${f.required ? '' : '?'}`) ?? [];
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        style={{
          stroke: p.selected ? 'var(--sl-color-rose-600)' : 'var(--sl-color-line-strong)',
          strokeWidth: 1.5,
        }}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan sl-edge-tools pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
        >
          <button
            type="button"
            aria-label="Insert a node on this edge"
            title={fields.length ? `Schema: ${fields.join(', ')}` : 'No schema yet'}
            onClick={(e) => insertAt(p.id, e.clientX, e.clientY)}
            className="sl-focus flex size-6 items-center justify-center rounded-pill border border-line-strong bg-surface text-muted shadow-card hover:border-rose-600 hover:text-rose-600"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

/**
 * SIM-06: while dragging a connection over an invalid handle, say why at the cursor
 * (SIM-CYCLE, SIM-PORT-TYPE, SIM-DUP-EDGE, SIM-PORT-TAKEN). Valid targets glow via CSS.
 */
export function ConnectionHint() {
  const c = useConnection();
  const [pt, setPt] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!c.inProgress) return;
    const move = (e: PointerEvent) => setPt({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [c.inProgress]);
  if (!c.inProgress || !c.toHandle || !c.fromHandle) return null;
  const { nodes, edges } = useGraph.getState();
  const forward = c.fromHandle.type === 'source';
  const from = forward ? c.fromHandle : c.toHandle;
  const to = forward ? c.toHandle : c.fromHandle;
  let issue;
  try {
    issue = connectionIssue(
      { nodes, edges },
      {
        source: from.nodeId,
        sourceHandle: from.id ?? 'main',
        target: to.nodeId,
        targetHandle: to.id ?? 'main',
      },
    );
  } catch {
    // Same-direction handle (output → output): React Flow refuses it; nothing to explain.
    return null;
  }
  if (!issue) return null;
  const msg = present(new AppError(issue.code, issue.params)).message;
  return (
    <div
      role="alert"
      className="pointer-events-none fixed z-40 max-w-[300px] rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-[18px] text-white shadow-pop"
      style={{ left: pt.x + 14, top: pt.y + 14 }}
    >
      {msg}
    </div>
  );
}
