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
import { create } from 'zustand';
import { fmt, useEdgeCount, useRun } from './run';
import { useGraph } from './store';
import { refCtx } from './refTables';

/** Which edge the pointer is over (React Flow's edge and its label live in different DOM subtrees). */
const useHover = create<{ id: string | null }>(() => ({ id: null }));
export const setHoveredEdge = (id: string | null) => useHover.setState({ id });

export type SlEdge = Edge<{ schema: Schema }, 'stream'>;

/** Canvas callbacks for edges, passed by context so edge data stays plain (no functions in state). */
export const EdgeActions = createContext<{ insertAt: (edgeId: string, x: number, y: number) => void }>({
  insertAt: () => {},
});

/** SIM-09 "+" at the midpoint on hover; SIM-25 the schema on hover. */
export const StreamEdge = memo(function StreamEdge(p: EdgeProps<SlEdge>) {
  const [path, lx, ly] = getBezierPath(p);
  const { insertAt } = useContext(EdgeActions);
  const hovered = useHover((h) => h.id === p.id);
  const count = useEdgeCount(p.id);
  const running = useRun((s) => s.state === 'running');
  const speed = useRun((s) => s.speed);
  // WM06: only edges carrying events flow, at a pace that scales with the sim speed (0.8 s at 1×).
  // ponytail: "carrying" = has carried any event this run; per-tick deltas if idle edges should stop mid-run.
  const flowing = running && !!count;
  const side =
    p.sourceHandleId &&
    p.sourceHandleId !== 'main' &&
    !p.sourceHandleId.startsWith('route-') &&
    p.sourceHandleId !== 'default';
  const fields = p.data?.schema.map((f) => `${f.name}: ${f.type}${f.required ? '' : '?'}`) ?? [];
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        style={{
          stroke: p.selected ? 'var(--sl-color-rose-600)' : 'var(--sl-color-line-strong)',
          strokeWidth: 1.5,
          ...(flowing ? { animationDuration: `${0.8 / speed}s` } : {}),
        }}
        // SIM-17: edges animate while running (tokens.css sl-flow; off under reduced motion).
        className={flowing ? 'sl-flow' : undefined}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        {/* SIM-17: events that crossed this edge (outside the hover tools, so it always shows). */}
        {count !== null && (
          <div
            // WM06 "Counter update 160 ms fade": remounted per value.
            key={count}
            className="sl-count pointer-events-none absolute rounded-pill bg-surface px-1.5 font-mono text-[11px] text-muted tabular-nums"
            style={{ transform: `translate(-50%, 0) translate(${lx}px, ${ly + 14}px)` }}
          >
            {fmt(count)}
            {side ? ` ${p.sourceHandleId}` : ''}
          </div>
        )}
        <div
          className={`nodrag nopan sl-edge-tools pointer-events-auto absolute flex items-center ${hovered || p.selected ? 'sl-edge-tools-on' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
        >
          <button
            type="button"
            aria-label="Insert a node on this edge"
            title={fields.length ? `Schema: ${fields.join(', ')}` : 'No schema yet'}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              // Keyboard clicks report (0, 0): open at the button instead.
              insertAt(p.id, e.clientX || r.left, e.clientY || r.bottom + 4);
            }}
            // Keep Enter/Space for this button: React Flow's edge handler would select the edge instead.
            onKeyDown={(e) => e.stopPropagation()}
            className="sl-focus flex size-6 items-center justify-center rounded-pill border border-line-strong bg-surface text-muted shadow-card hover:border-rose-600 hover:text-rose-600"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          {hovered && fields.length > 0 && (
            <span
              role="tooltip"
              className="absolute top-full left-1/2 mt-1 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] leading-4 text-muted shadow-card"
            >
              {fields.join(', ')}
            </span>
          )}
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
      refCtx(),
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
