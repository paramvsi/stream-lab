# Simulator canvas (React Flow)

Boards: `W09*` (canvas states), `W10*` (node drawer), `T0*`/`E0*` (tour, explain), `WM03`/`WM06` (motion), `B03` (node library).

## Layout (1440×900 reference)
Header 56 px (logo, pipeline name, undo/redo/history, Tour, Explain run, Data, Share, Export) · left **palette** 264 px · canvas · floating **run pill** top-centre · **minimap** top-right (170×96) · **controls** bottom-left (zoom in/out, fit, lock + zoom %) · bottom **drawer** (node config 360 px, or run panel 250 px with tabs Timeline/Output/Trace/Flink SQL/Problems). Drawer is resizable (min 200, max 70% height), collapses to a 40 px bar.

## React Flow setup
```tsx
<ReactFlow
  nodes={nodes} edges={edges} nodeTypes={nodeTypes /* memoised, defined outside component */} edgeTypes={edgeTypes}
  onNodesChange onEdgesChange onConnect
  isValidConnection={isValidConnection}       // cycles + port schema (SIM-CYCLE, SIM-PORT-TYPE)
  onConnectEnd={onConnectEnd}                 // dropped on empty pane → quick-add menu at that point, auto-connect
  onNodeDragStop={snapshot} onSelectionDragStop={snapshot}
  onPaneContextMenu onNodeContextMenu onEdgeContextMenu
  snapToGrid snapGrid={[8, 8]} fitView minZoom={0.25} maxZoom={2}
  deleteKeyCode={['Backspace','Delete']} multiSelectionKeyCode="Shift" selectionOnDrag panOnDrag={[1,2]} panOnScroll
  connectionLineComponent={RoseConnectionLine} defaultEdgeOptions={{ type: 'stream' }}
  proOptions={{ hideAttribution: false }}      // keep attribution unless we buy Pro
>
  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--sl-color-line)" />
  <MiniMap position="top-right" pannable zoomable nodeColor={n => categoryAccent(n)} />
  <Controls position="bottom-left" showInteractive />
  <Panel position="top-center"><RunPill /></Panel>
  <HelperLines />                              // from React Flow "helper lines" example; snap within 6 px
</ReactFlow>
```
Rules:
- Custom node components are `memo`'d; read run-time counts from a separate store via selectors (do **not** put per-event counts into `nodes` — it re-renders the graph). Edge counts render in a custom edge label (`EdgeLabelRenderer`).
- Interactive controls inside nodes get `className="nodrag nopan"`.
- `NodeToolbar` (Configure, Run to here, Duplicate, Disable, Delete) shows for a single selected node; hidden while dragging.
- Handles: `main` = circle, side outputs `rejected` / `late` = diamond, coloured per type; `Handle id` = port id. Target handles validate via `isValidConnection`.
- `isValidConnection`: reject self-loops, cycles (DFS with `getOutgoers`), duplicate edge, schema mismatch, port arity (Join has `left`/`right`; Source has no input).
- Insert-on-edge: hovering an edge shows a "+" at midpoint (custom edge); click → quick-add, splices node in and reconnects (one undo step).
- Auto-layout: elkjs `layered`, direction RIGHT, spacing 64/96; animate positions 300 ms; one undo step; toast "Layout applied" with Undo.
- Copy/paste: ⌘C/⌘V with offset +24 px, new ids, keep internal edges.
- Viewport, nodes, edges persist to IndexedDB (autosave debounced 500 ms) + `beforeunload` flush.

## Undo / redo
- `zundo` temporal middleware on the graph store, `limit: 100`, `partialize` to `{nodes(without selected/dragging), edges, nodeConfig}`.
- Snapshot boundaries: drag stop, connect, delete, paste, config field **blur** (not every keystroke), auto-layout, insert-on-edge. Group with `handleSet` throttling.
- Shortcuts: ⌘Z, ⇧⌘Z, ⌘Y. History popover lists labelled entries ("Moved Window", "Connected Validate → Window") and jumps to any.
- Run state is **not** in history. Undo while running → pauses run first (toast info).

## Run states (pill + canvas)
| State | Pill | Canvas |
|---|---|---|
| idle/ready | Run (primary) · Step · Speed 1× · Chaos | static edges |
| running | Pause · Step disabled · Speed · events/s · watermark time | `stream` edges animate (`sl-flow`), counts tick, busiest node `sl-glow` |
| paused | Resume · Step (next event) · Reset | event dot sits on edge; step badges |
| finished | Run again · Reset · "38,200 events · 0 errors" | Output tab opens |
| error/blocked | Run disabled + tooltip `SIM-RUN-BLOCKED` | error nodes: danger ring + "!" badge; Problems tab opens |
| crashed | dialog `SIM-ENGINE-CRASH` | frozen |

Engine runs in a Worker (`packages/engine`); main thread sends graph + data seed, receives batched stats every 100 ms (`{edgeCounts, nodeStats, watermark, outputsDelta, problems}`), never per-event messages. Heartbeat every 1 s; 3 missed = crash.

## Tour (T01–T06) and Explain (E01–E05)
- Tour: 5 steps, spotlight (box-shadow cutout + rose ring, `sl-spot`), coach card with step dots, Back/Next/Skip; each step waits for the action ("Drag a Source onto the canvas") or Next. Store completion; offer from header "Tour". Esc = skip. Spotlight follows element via `ResizeObserver` and `useOnViewportChange`.
- Explain this run: pick an output row or "random event"; steps through its path: non-path nodes dim to 35%, path edges highlight, numbered step badges, narration card explains each decision with actual values ("amount 980.00 > 0 ✓"). Keyboard ←/→. Uses engine trace data (lineage ids recorded per event in explain mode only).
