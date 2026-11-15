import {
  connectionIssue,
  labelOf,
  spec,
  type NodeType,
  type PipelineEdge,
  type PipelineNode,
} from '@sl/graph';
import { temporal } from 'zundo';
import { create } from 'zustand';

/** What undo/redo restores (SIMULATOR.md: nodes without selection/drag state, edges, config). */
interface Snapshot {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  /** How this state was reached — shown in the history popover ("Moved Window"). */
  label: string;
}

export interface GraphState extends Snapshot {
  pipelineId: string;
  name: string;
  /** UI-only, never in history. */
  selected: string[];
  selectedEdges: string[];
  clipboard: { nodes: PipelineNode[]; edges: PipelineEdge[] } | null;

  load(p: { id: string; name: string; nodes: PipelineNode[]; edges: PipelineEdge[] }): void;
  addNode(type: NodeType, position: { x: number; y: number }, connectFrom?: ConnectFrom): string;
  connect(e: Omit<PipelineEdge, 'id'>): void;
  /** Live drag: positions change without history; `endDrag` records one "Moved …" step. */
  beginDrag(): void;
  dragTo(positions: Record<string, { x: number; y: number }>): void;
  endDrag(): void;
  /** One step for many moves (auto-layout). */
  setPositions(positions: Record<string, { x: number; y: number }>, label: string): void;
  /** Config edits are committed on field blur by the drawer (M2), so each call is one step. */
  updateConfig(id: string, config: unknown): void;
  /**
   * NODE-07: a field edit session. beginEdit on focus; liveConfig while typing (no history, so validation and
   * the node badge update live); endEdit on blur records ONE "Changed … settings" step if anything changed.
   */
  beginEdit(): void;
  liveConfig(id: string, config: unknown): void;
  endEdit(id: string): void;
  rename(id: string, label: string): void;
  toggleDisabled(ids: string[]): void;
  duplicate(ids: string[]): string[];
  /** Returns what was removed, so "Undo" in the SIM-DELETE-UNDO toast can put exactly that back. */
  deleteSelection(): Removed;
  /** Re-add removed nodes/edges as a new step (edges to nodes that no longer exist are dropped). */
  restore(r: Removed): void;
  /** A move outside a drag (arrow keys): one labelled step. */
  nudge(positions: Record<string, { x: number; y: number }>): void;
  isDragging(): boolean;
  removeEdge(id: string): void;
  insertOnEdge(edgeId: string, type: NodeType): string;
  copySelection(): void;
  paste(): string[];
  select(nodes: string[], edges?: string[]): void;
  setName(name: string): void;
}

export interface Removed {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface ConnectFrom {
  nodeId: string;
  handleId: string;
  /** true = the drag started at an input handle; connect new node's output into it. */
  fromTarget?: boolean;
}

export const PASTE_OFFSET = 24;
export const HISTORY_LIMIT = 100;

let counter = 0;
export const newId = (prefix: string) =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${++counter}`).replace(/-/g, '').slice(0, 10)}`;

const edgeId = (e: Omit<PipelineEdge, 'id'>) =>
  `e_${e.source}_${e.sourceHandle}_${e.target}_${e.targetHandle}`;

function firstPort(type: NodeType, side: 'inputs' | 'outputs') {
  const s = spec(type);
  return s[side](s.defaults())[0]?.id;
}

function freshNode(type: NodeType, position: { x: number; y: number }): PipelineNode {
  return { id: newId('n'), type, position, config: spec(type).defaults() };
}

let dragSnapshot: Snapshot | null = null;
let editSnapshot: Snapshot | null = null;
let dragMoved = new Set<string>();

export const useGraph = create<GraphState>()(
  temporal<GraphState, [], [], Snapshot>(
    (set, get) => ({
      pipelineId: '',
      name: 'Untitled pipeline',
      nodes: [],
      edges: [],
      label: 'Opened',
      selected: [],
      selectedEdges: [],
      clipboard: null,

      load: (p) => {
        set({
          pipelineId: p.id,
          name: p.name,
          nodes: p.nodes,
          edges: p.edges,
          label: 'Opened',
          selected: [],
          selectedEdges: [],
        });
        useGraph.temporal.getState().clear();
      },

      addNode: (type, position, from) => {
        const n = freshNode(type, position);
        const edges = [...get().edges];
        if (from) {
          const port = firstPort(type, from.fromTarget ? 'outputs' : 'inputs');
          if (port) {
            const e = from.fromTarget
              ? { source: n.id, sourceHandle: port, target: from.nodeId, targetHandle: from.handleId }
              : { source: from.nodeId, sourceHandle: from.handleId, target: n.id, targetHandle: port };
            // Same rules as a drag (SIM-PORT-TAKEN, SIM-PORT-TYPE…): if refused, the node is added unconnected.
            if (!connectionIssue({ nodes: [...get().nodes, n], edges }, e))
              edges.push({ id: edgeId(e), ...e });
          }
        }
        set({ nodes: [...get().nodes, n], edges, selected: [n.id], label: `Added ${type}` });
        return n.id;
      },

      connect: (e) => {
        const byId = (id: string) => get().nodes.find((n) => n.id === id);
        const a = byId(e.source);
        const b = byId(e.target);
        set({
          edges: [...get().edges, { id: edgeId(e), ...e }],
          label: `Connected ${a ? labelOf(a) : '?'} → ${b ? labelOf(b) : '?'}`,
        });
      },

      beginDrag: () => {
        const { nodes, edges, label } = get();
        dragSnapshot = { nodes, edges, label };
        dragMoved = new Set();
        useGraph.temporal.getState().pause();
      },
      dragTo: (positions) => {
        for (const id of Object.keys(positions)) dragMoved.add(id);
        set({ nodes: get().nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)) });
      },
      endDrag: () => {
        const t = useGraph.temporal.getState();
        const before = dragSnapshot;
        dragSnapshot = null;
        if (!before || dragMoved.size === 0) return t.resume();
        const moved = get().nodes.filter((n) => dragMoved.has(n.id));
        const label = moved.length === 1 ? `Moved ${labelOf(moved[0]!)}` : `Moved ${moved.length} nodes`;
        set({ label }); // still paused: the present just gets its label
        t.resume();
        // Record the pre-drag state as one undo step.
        useGraph.temporal.setState({
          pastStates: [...t.pastStates, before].slice(-HISTORY_LIMIT),
          futureStates: [],
        });
      },

      beginEdit: () => {
        if (editSnapshot) return;
        const { nodes, edges, label } = get();
        editSnapshot = { nodes, edges, label };
        useGraph.temporal.getState().pause();
      },
      liveConfig: (id, config) =>
        set({ nodes: get().nodes.map((x) => (x.id === id ? { ...x, config } : x)) }),
      endEdit: (id) => {
        const t = useGraph.temporal.getState();
        const before = editSnapshot;
        editSnapshot = null;
        if (!before) return;
        const n = get().nodes.find((x) => x.id === id);
        if (get().nodes === before.nodes) return t.resume();
        set({ label: `Changed ${n ? labelOf(n) : 'node'} settings` });
        t.resume();
        useGraph.temporal.setState({
          pastStates: [...t.pastStates, before].slice(-HISTORY_LIMIT),
          futureStates: [],
        });
      },

      setPositions: (positions, label) =>
        set({
          nodes: get().nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)),
          label,
        }),

      updateConfig: (id, config) => {
        const n = get().nodes.find((x) => x.id === id);
        set({
          nodes: get().nodes.map((x) => (x.id === id ? { ...x, config } : x)),
          label: `Changed ${n ? labelOf(n) : 'node'} settings`,
        });
      },

      rename: (id, label) =>
        set({
          nodes: get().nodes.map((x) => (x.id === id ? { ...x, label } : x)),
          label: `Renamed to ${label || 'default'}`,
        }),

      toggleDisabled: (ids) => {
        const nodes = get().nodes.map((n) => (ids.includes(n.id) ? { ...n, disabled: !n.disabled } : n));
        const one = nodes.find((n) => n.id === ids[0]);
        set({
          nodes,
          label:
            ids.length === 1 && one
              ? `${one.disabled ? 'Disabled' : 'Enabled'} ${labelOf(one)}`
              : 'Toggled nodes',
        });
      },

      duplicate: (ids) => {
        // Nothing (or only stale ids) to copy: no history step, redo stays intact.
        if (!get().nodes.some((n) => ids.includes(n.id))) return [];
        const copies = get()
          .nodes.filter((n) => ids.includes(n.id))
          .map((n) => ({
            ...n,
            id: newId('n'),
            position: { x: n.position.x + PASTE_OFFSET, y: n.position.y + PASTE_OFFSET },
          }));
        set({
          nodes: [...get().nodes, ...copies],
          selected: copies.map((c) => c.id),
          label:
            copies.length === 1 ? `Duplicated ${labelOf(copies[0]!)}` : `Duplicated ${copies.length} nodes`,
        });
        return copies.map((c) => c.id);
      },

      deleteSelection: () => {
        const { selected, selectedEdges, nodes, edges } = get();
        const gone = new Set(selected);
        if (!gone.size && !selectedEdges.length) return { nodes: [], edges: [] };
        const left = edges.filter(
          (e) => !gone.has(e.source) && !gone.has(e.target) && !selectedEdges.includes(e.id),
        );
        const removed = nodes.filter((n) => gone.has(n.id));
        set({
          nodes: nodes.filter((n) => !gone.has(n.id)),
          edges: left,
          selected: [],
          selectedEdges: [],
          label:
            removed.length === 1
              ? `Deleted ${labelOf(removed[0]!)}`
              : removed.length
                ? `Deleted ${removed.length} nodes`
                : `Deleted ${edges.length - left.length} edge${edges.length - left.length === 1 ? '' : 's'}`,
        });
        return { nodes: removed, edges: edges.filter((e) => !left.includes(e)) };
      },

      restore: (r) => {
        const have = new Set(get().nodes.map((n) => n.id));
        const nodes = r.nodes.filter((n) => !have.has(n.id));
        const ids = new Set([...have, ...nodes.map((n) => n.id)]);
        const known = new Set(get().edges.map((e) => e.id));
        // Re-check each edge against what the graph looks like now (another edge may have taken the input,
        // or a later edge may close a loop): refused ones are dropped, the nodes still come back.
        const allNodes = [...get().nodes, ...nodes];
        const edges: PipelineEdge[] = [];
        for (const e of r.edges) {
          if (!ids.has(e.source) || !ids.has(e.target) || known.has(e.id)) continue;
          if (!connectionIssue({ nodes: allNodes, edges: [...get().edges, ...edges] }, e)) edges.push(e);
        }
        if (!nodes.length && !edges.length) return;
        set({
          nodes: [...get().nodes, ...nodes],
          edges: [...get().edges, ...edges],
          selected: nodes.map((n) => n.id),
          label:
            nodes.length === 1
              ? `Restored ${labelOf(nodes[0]!)}`
              : nodes.length
                ? `Restored ${nodes.length} nodes`
                : 'Restored edges',
        });
      },

      nudge: (positions) => {
        const moved = get().nodes.filter((n) => positions[n.id]);
        if (!moved.length) return;
        set({
          nodes: get().nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)),
          label: moved.length === 1 ? `Moved ${labelOf(moved[0]!)}` : `Moved ${moved.length} nodes`,
        });
      },

      isDragging: () => dragSnapshot !== null,

      removeEdge: (id) => set({ edges: get().edges.filter((e) => e.id !== id), label: 'Removed edge' }),

      insertOnEdge: (id, type) => {
        const e = get().edges.find((x) => x.id === id);
        if (!e) throw new Error(`insertOnEdge: no edge ${id}`);
        const a = get().nodes.find((n) => n.id === e.source)!;
        const b = get().nodes.find((n) => n.id === e.target)!;
        const n = freshNode(type, {
          x: (a.position.x + b.position.x) / 2,
          y: (a.position.y + b.position.y) / 2,
        });
        const inPort = firstPort(type, 'inputs');
        const outPort = firstPort(type, 'outputs');
        if (!inPort || !outPort) throw new Error(`insertOnEdge: ${type} needs an input and an output`);
        const e1 = { source: e.source, sourceHandle: e.sourceHandle, target: n.id, targetHandle: inPort };
        const e2 = { source: n.id, sourceHandle: outPort, target: e.target, targetHandle: e.targetHandle };
        set({
          nodes: [...get().nodes, n],
          edges: [
            ...get().edges.filter((x) => x.id !== id),
            { id: edgeId(e1), ...e1 },
            { id: edgeId(e2), ...e2 },
          ],
          selected: [n.id],
          label: `Inserted ${type} on ${labelOf(a)} → ${labelOf(b)}`,
        });
        return n.id;
      },

      copySelection: () => {
        const ids = new Set(get().selected);
        if (!ids.size) return;
        set({
          clipboard: {
            nodes: get().nodes.filter((n) => ids.has(n.id)),
            // Keep only edges inside the selection.
            edges: get().edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
          },
        });
      },

      paste: () => {
        const clip = get().clipboard;
        if (!clip?.nodes.length) return [];
        const map = new Map(clip.nodes.map((n) => [n.id, newId('n')]));
        const nodes = clip.nodes.map((n) => ({
          ...n,
          id: map.get(n.id)!,
          position: { x: n.position.x + PASTE_OFFSET, y: n.position.y + PASTE_OFFSET },
        }));
        const edges = clip.edges.map((e) => {
          const x = { ...e, source: map.get(e.source)!, target: map.get(e.target)! };
          return { ...x, id: edgeId(x) };
        });
        // Next paste lands one more offset away.
        set({
          nodes: [...get().nodes, ...nodes],
          edges: [...get().edges, ...edges],
          selected: nodes.map((n) => n.id),
          clipboard: { nodes, edges },
          label: `Pasted ${nodes.length} node${nodes.length === 1 ? '' : 's'}`,
        });
        return nodes.map((n) => n.id);
      },

      select: (nodes, edges = []) => set({ selected: nodes, selectedEdges: edges }),
      setName: (name) => set({ name }),
    }),
    {
      limit: HISTORY_LIMIT,
      partialize: ({ nodes, edges, label }) => ({ nodes, edges, label }),
      // Selection, clipboard and name changes are not undo steps.
      equality: (a, b) => a.nodes === b.nodes && a.edges === b.edges,
    },
  ),
);

// Undo/redo (and any removal) can leave ids of nodes/edges that no longer exist in the selection; React Flow
// can't deselect what it doesn't render, so they'd stick (and hide the single-selection toolbar). Prune them.
useGraph.subscribe((st, prev) => {
  if (st.nodes === prev.nodes && st.edges === prev.edges) return;
  const nodeIds = new Set(st.nodes.map((n) => n.id));
  const edgeIds = new Set(st.edges.map((e) => e.id));
  const selected = st.selected.filter((id) => nodeIds.has(id));
  const selectedEdges = st.selectedEdges.filter((id) => edgeIds.has(id));
  if (selected.length !== st.selected.length || selectedEdges.length !== st.selectedEdges.length)
    useGraph.setState({ selected, selectedEdges });
});

/** History entries, oldest first; the last is the present (SIM-12 popover). */
export function historyEntries() {
  const t = useGraph.temporal.getState();
  return [...t.pastStates.map((s) => s.label ?? ''), useGraph.getState().label];
}
