import { AppError, present, toProblems } from '@sl/errors';
import {
  connectionIssue,
  labelOf,
  propagate,
  runBlocker,
  spec,
  validate,
  type NodeType,
  type PipelineNode,
} from '@sl/graph';
import { Button, EmptyState, IconButton, ProblemsPanel, useToast } from '@sl/ui';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import './canvas.css';
import { History, LayoutGrid, Play, Redo2, Undo2, Workflow } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useStore } from 'zustand';
import {
  CanvasMenu,
  ConnectPicker,
  HelperLines,
  NodeActions,
  NodeDrawer,
  useAutoLayout,
  type MenuTarget,
  type NodeActionsApi,
} from './CanvasExtras';
import { snapGuides, type Guides } from './geometry';
import { setIssues, useIssues } from './issues';
import { accent } from './look';
import { NODE_H, NODE_W, NodeCard, type SlNode } from './NodeCard';
import { DRAG_TYPE, Palette } from './Palette';
import { QuickAdd, type QuickAddNeed } from './QuickAdd';
import { historyEntries, useGraph, type ConnectFrom } from './store';
import { ConnectionHint, EdgeActions, StreamEdge, type SlEdge } from './StreamEdge';

const nodeTypes = { sl: NodeCard };

const onGrid = (p: { x: number; y: number }) => ({ x: Math.round(p.x / 8) * 8, y: Math.round(p.y / 8) * 8 });

/** Adding at the centre again places the next node to the right (one card + 48 px), never on top of another. */
function freeSpot(p: { x: number; y: number }) {
  let q = onGrid(p);
  const taken = (r: { x: number; y: number }) =>
    useGraph
      .getState()
      .nodes.some((n) => Math.abs(n.position.x - r.x) < NODE_W && Math.abs(n.position.y - r.y) < NODE_H);
  for (let i = 0; i < 50 && taken(q); i++) q = { x: q.x + NODE_W + 48, y: q.y };
  return q;
}
const edgeTypes = { stream: StreamEdge };
const msg = (code: Parameters<typeof present>[0]['code'], params: Record<string, string | number> = {}) =>
  present(new AppError(code, params)).message;

// One `data` object per PipelineNode identity, so unchanged nodes keep their props and skip re-render.
const dataCache = new WeakMap<PipelineNode, { node: PipelineNode }>();
const dataFor = (n: PipelineNode) => {
  let d = dataCache.get(n);
  if (!d) dataCache.set(n, (d = { node: n }));
  return d;
};

interface QuickAddState {
  x: number;
  y: number;
  flow: { x: number; y: number };
  need: QuickAddNeed;
  from?: ConnectFrom;
  edgeId?: string;
}

function Canvas() {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const selected = useGraph((s) => s.selected);
  const selectedEdges = useGraph((s) => s.selectedEdges);
  const g = useGraph.getState;
  const rf = useReactFlow();
  const toast = useToast();
  const wrap = useRef<HTMLElement>(null);
  const [quick, setQuick] = useState<QuickAddState | null>(null);
  const [fitOnOpen] = useState(() => useGraph.getState().nodes.length > 0);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [guides, setGuides] = useState<Omit<Guides, 'pos'>>({});
  const layout = useAutoLayout();

  // SIM-14: validation on every change (NODES.md: debounced 150 ms).
  useEffect(() => {
    const t = setTimeout(() => setIssues(validate({ nodes, edges })), 150);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const schemas = useMemo(() => propagate({ nodes, edges }), [nodes, edges]);
  const rfNodes = useMemo<SlNode[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'sl',
        position: n.position,
        data: dataFor(n),
        selected: selected.includes(n.id),
        width: NODE_W,
        height: NODE_H,
      })),
    [nodes, selected],
  );
  const rfEdges = useMemo<SlEdge[]>(
    () =>
      edges.map((e) => ({
        ...e,
        type: 'stream',
        data: { schema: schemas.edge.get(e.id) ?? [] },
        selected: selectedEdges.includes(e.id),
      })),
    [edges, schemas, selectedEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<SlNode>[]) => {
      const pos: Record<string, { x: number; y: number }> = {};
      let sel: Set<string> | null = null;
      const moving: string[] = [];
      let dragging = false;
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          pos[c.id] = c.position;
          moving.push(c.id);
          if (c.dragging) dragging = true;
        }
        if (c.type === 'select') {
          sel ??= new Set(g().selected);
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        }
      }
      // SIM-05: a single moved node snaps to other nodes within 6 px (also on the final drag-stop change,
      // which React Flow sends grid-snapped); guide lines show only while dragging.
      if (moving.length === 1) {
        const id = moving[0]!;
        const snap = snapGuides(
          pos[id]!,
          g()
            .nodes.filter((n) => n.id !== id)
            .map((n) => n.position),
        );
        pos[id] = snap.pos;
        setGuides(dragging ? { x: snap.x, y: snap.y } : {});
      }
      if (Object.keys(pos).length) g().dragTo(pos);
      if (sel) g().select([...sel], g().selectedEdges);
    },
    [g],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<SlEdge>[]) => {
      let sel: Set<string> | null = null;
      for (const c of changes)
        if (c.type === 'select') {
          sel ??= new Set(g().selectedEdges);
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        }
      if (sel) g().select(g().selected, [...sel]);
    },
    [g],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
      try {
        return !connectionIssue(
          { nodes: g().nodes, edges: g().edges },
          {
            source: c.source,
            target: c.target,
            sourceHandle: c.sourceHandle ?? 'main',
            targetHandle: c.targetHandle ?? 'main',
          },
        );
      } catch {
        return false;
      }
    },
    [g],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      g().connect({
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle ?? 'main',
        targetHandle: c.targetHandle ?? 'main',
      });
    },
    [g],
  );

  // SIM-08: a connection dropped on empty pane opens quick-add there, then auto-connects.
  const onConnectEnd = useCallback(
    (e: MouseEvent | TouchEvent, s: FinalConnectionState) => {
      if (s.isValid || s.toHandle || !s.fromHandle) return;
      const p = 'changedTouches' in e ? e.changedTouches[0]! : e;
      const fromTarget = s.fromHandle.type === 'target';
      setQuick({
        x: p.clientX,
        y: p.clientY,
        flow: rf.screenToFlowPosition({ x: p.clientX, y: p.clientY }),
        need: fromTarget ? 'output' : 'input',
        from: { nodeId: s.fromHandle.nodeId, handleId: s.fromHandle.id ?? 'main', fromTarget },
      });
    },
    [rf],
  );

  const openQuick = useCallback(
    (x: number, y: number) => setQuick({ x, y, flow: rf.screenToFlowPosition({ x, y }), need: 'any' }),
    [rf],
  );

  // Shortcuts (SIM-11, SIM-12, SIM-04) work anywhere in the workspace except text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const h = useGraph.temporal.getState();
      if (mod && k === 'z' && !e.shiftKey) h.undo();
      else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) h.redo();
      else if (mod && k === 'c') g().copySelection();
      else if (mod && k === 'v') g().paste();
      else if (mod && k === 'd') g().duplicate(g().selected);
      else if (!mod && e.key === 'Enter' && t?.closest('.react-flow__node')) {
        // NODE-01: Enter on a focused node opens its settings.
        const id = t.closest('.react-flow__node')!.getAttribute('data-id');
        if (id) setDrawerFor(id);
      } else if (!mod && e.key === '/') {
        const r = wrap.current!.getBoundingClientRect();
        openQuick(r.left + r.width / 2 - 150, r.top + r.height / 3);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [g, openQuick]);

  const insertAt = useCallback(
    (edgeId: string, x: number, y: number) =>
      setQuick({ x, y, flow: rf.screenToFlowPosition({ x, y }), need: 'both', edgeId }),
    [rf],
  );

  const center = () => {
    const r = wrap.current?.getBoundingClientRect();
    const p = rf.screenToFlowPosition({
      x: (r?.left ?? 0) + (r?.width ?? 0) / 2,
      y: (r?.top ?? 0) + (r?.height ?? 0) / 2,
    });
    return freeSpot({ x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  };

  const pick = (type: NodeType) => {
    if (!quick) return;
    if (quick.edgeId) g().insertOnEdge(quick.edgeId, type);
    else g().addNode(type, { x: quick.flow.x - NODE_W / 2, y: quick.flow.y - NODE_H / 2 }, quick.from);
    setQuick(null);
  };

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DRAG_TYPE) as NodeType;
    if (!type) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    g().addNode(type, onGrid({ x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }));
  };

  // Delete goes through the store so it is one undo step with an Undo toast (SIM-DELETE-UNDO).
  const removeWithUndo = useCallback(
    (nodeIds: string[], edgeIds: string[] = []) => {
      g().select(nodeIds, edgeIds);
      const n = g().deleteSelection();
      if (n > 0) {
        const p = present(new AppError('SIM-DELETE-UNDO', { n }));
        toast({
          severity: p.severity,
          message: p.message,
          action: { label: 'Undo', onClick: () => useGraph.temporal.getState().undo() },
        });
      }
    },
    [g, toast],
  );
  const onBeforeDelete = useCallback(
    async ({ nodes: ns, edges: es }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
      removeWithUndo(
        ns.map((n) => n.id),
        es.map((e) => e.id),
      );
      return false;
    },
    [removeWithUndo],
  );

  const actions: NodeActionsApi = {
    configure: setDrawerFor,
    connectFrom: setConnectFor,
    remove: (ids) => removeWithUndo(ids),
    layout: () => void layout(),
    addAt: openQuick,
    insertOnEdge: insertAt,
  };
  const drawerNode = drawerFor ? nodes.find((n) => n.id === drawerFor) : undefined;

  return (
    <NodeActions.Provider value={actions}>
      <EdgeActions.Provider value={{ insertAt }}>
        <div className="flex min-h-0 flex-1">
          <Palette onAdd={(t) => g().addNode(t, center())} />
          <main
            ref={wrap}
            aria-label="Canvas"
            className="relative min-w-0 flex-1"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={onDrop}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).classList.contains('react-flow__pane'))
                openQuick(e.clientX, e.clientY);
            }}
          >
            <ReactFlow<SlNode, SlEdge>
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onBeforeDelete={onBeforeDelete}
              onNodeDragStart={() => g().beginDrag()}
              onNodeDragStop={() => {
                setGuides({});
                g().endDrag();
              }}
              onNodeDoubleClick={(_, n) => setDrawerFor(n.id)}
              onNodeContextMenu={(e, n) => {
                e.preventDefault();
                setMenu({ kind: 'node', id: n.id, x: e.clientX, y: e.clientY });
              }}
              onEdgeContextMenu={(e, ed) => {
                e.preventDefault();
                setMenu({ kind: 'edge', id: ed.id, x: e.clientX, y: e.clientY });
              }}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                setMenu({ kind: 'pane', x: e.clientX, y: e.clientY });
              }}
              onSelectionDragStart={() => g().beginDrag()}
              onSelectionDragStop={() => g().endDrag()}
              snapToGrid
              snapGrid={[8, 8]}
              // Fit only a pipeline that opens with nodes; an empty canvas starts at 100 % (fitting the
              // first added node would zoom to the 2× max).
              fitView={fitOnOpen}
              fitViewOptions={{ maxZoom: 1 }}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              minZoom={0.25}
              maxZoom={2}
              zoomOnDoubleClick={false}
              deleteKeyCode={['Backspace', 'Delete']}
              multiSelectionKeyCode="Shift"
              selectionOnDrag
              panOnDrag={[1, 2]}
              panOnScroll
              defaultEdgeOptions={{ type: 'stream' }}
              proOptions={{ hideAttribution: false }}
              aria-label="Pipeline canvas"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--sl-color-line)" />
              <MiniMap
                position="top-right"
                pannable
                zoomable
                ariaLabel="Pipeline overview"
                style={{ width: 170, height: 96 }}
                nodeColor={(n) => accent(spec((n as SlNode).data.node.type).category)}
              />
              <Controls position="bottom-left" showInteractive>
                <ControlButton onClick={() => void layout()} aria-label="Auto-layout" title="Auto-layout">
                  <LayoutGrid size={14} aria-hidden="true" />
                </ControlButton>
              </Controls>
              <HelperLines x={guides.x} y={guides.y} />
              <Panel position="top-center">
                <RunPill />
              </Panel>
              <ConnectionHint />
            </ReactFlow>
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="pointer-events-auto rounded-xl border border-line bg-surface shadow-card">
                  <EmptyState icon={Workflow} title="Start with a source">
                    Drag Source from the left, double-click the canvas, or press / to add any node.
                  </EmptyState>
                </div>
              </div>
            )}
            {quick && (
              <QuickAdd
                x={quick.x}
                y={quick.y}
                need={quick.need}
                onPick={pick}
                onClose={() => setQuick(null)}
              />
            )}
            <CanvasMenu target={menu} onClose={() => setMenu(null)} />
          </main>
        </div>
        {drawerNode && (
          <NodeDrawer key={drawerNode.id} node={drawerNode} onClose={() => setDrawerFor(null)} />
        )}
        {connectFor && <ConnectPicker fromId={connectFor} onClose={() => setConnectFor(null)} />}
      </EdgeActions.Provider>
    </NodeActions.Provider>
  );
}

/** Run pill (board W09f). Running is M3: Run is explained-disabled until then. */
function RunPill() {
  const all = useIssues((s) => s.all);
  const blocker = runBlocker(all);
  return (
    <div className="flex items-center gap-2 rounded-pill border border-line bg-surface py-1 pr-1 pl-3.5 shadow-card">
      <span className="text-[13px] font-medium text-muted">{blocker ? 'Not ready' : 'Ready'}</span>
      <Button
        size="sm"
        variant="primary"
        icon={<Play size={14} aria-hidden="true" />}
        disabledReason={blocker ? msg(blocker.code, blocker.params) : 'The engine arrives in the next build.'}
      >
        Run
      </Button>
    </div>
  );
}

function Header() {
  const name = useGraph((s) => s.name);
  const past = useStore(useGraph.temporal, (t) => t.pastStates.length);
  const future = useStore(useGraph.temporal, (t) => t.futureStates.length);
  const t = useGraph.temporal.getState;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line bg-surface px-4">
      <h1 className="sr-only">Pipeline editor</h1>
      <a
        href="#/"
        className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em] text-ink no-underline"
      >
        <img src="/logo-mark.svg" width={24} height={24} alt="" />
        stream<span className="text-rose-600">lab</span>
      </a>
      <span aria-hidden="true" className="text-line-strong">
        /
      </span>
      <input
        aria-label="Pipeline name"
        value={name}
        onChange={(e) => useGraph.getState().setName(e.target.value)}
        className="sl-focus min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold hover:border-line"
      />
      <div className="flex gap-0.5 rounded-lg border border-line p-0.5">
        <UndoButton
          label="Undo"
          shortcut="⌘Z"
          count={past}
          onClick={() => t().undo()}
          icon={<Undo2 size={16} />}
        />
        <UndoButton
          label="Redo"
          shortcut="⇧⌘Z"
          count={future}
          onClick={() => t().redo()}
          icon={<Redo2 size={16} />}
        />
        <HistoryPopover />
      </div>
    </header>
  );
}

function UndoButton(p: {
  label: string;
  shortcut: string;
  count: number;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  // SIM-UNDO-EMPTY: "Nothing to undo." (button disabled + tooltip)
  const reason =
    p.count === 0 ? (p.label === 'Undo' ? msg('SIM-UNDO-EMPTY') : 'Nothing to redo.') : undefined;
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`${p.label} (${p.shortcut})`}
      disabledReason={reason}
      onClick={p.onClick}
      className="!px-2"
    >
      {p.icon}
    </Button>
  );
}

function HistoryPopover() {
  const [open, setOpen] = useState(false);
  const entries = open ? historyEntries() : [];
  const futureLabels = open
    ? useGraph.temporal
        .getState()
        .futureStates.map((s) => s.label ?? '')
        .reverse()
    : [];
  const here = entries.length - 1;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton aria-label="History" size="sm" bordered={false}>
          <History size={16} aria-hidden="true" />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[280px] rounded-lg border border-line bg-surface p-1.5 shadow-pop"
          aria-label="Undo history"
        >
          <ol className="m-0 flex max-h-[360px] list-none flex-col overflow-y-auto p-0">
            {[...entries, ...futureLabels].map((label, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-current={i === here ? 'step' : undefined}
                  onClick={() => {
                    const t = useGraph.temporal.getState();
                    if (i < here) t.undo(here - i);
                    else if (i > here) t.redo(i - here);
                    setOpen(false);
                  }}
                  className={`sl-focus w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle aria-[current=step]:bg-rose-50 aria-[current=step]:font-semibold ${i > here ? 'text-muted' : ''}`}
                >
                  {label}
                </button>
              </li>
            ))}
          </ol>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ProblemsBar() {
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
    <section
      aria-label="Run panel"
      className="h-[200px] shrink-0 overflow-y-auto border-t border-line bg-surface"
    >
      <h2 className="m-0 border-b border-line px-4 py-2 text-[13px] font-semibold">
        Problems <span className="font-mono text-muted">{all.length}</span>
      </h2>
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
    </section>
  );
}

/** W09 workspace: header, palette, canvas, run pill, problems. */
export function Workspace() {
  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-surface">
        <Header />
        <Canvas />
        <ProblemsBar />
      </div>
    </ReactFlowProvider>
  );
}
