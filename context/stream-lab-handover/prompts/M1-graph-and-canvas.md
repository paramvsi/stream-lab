# M1 · Graph and canvas (Phase 1)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/SIMULATOR.md`, `docs/NODES.md`, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build packages/graph (pipeline model v1 with migrations, a zod schema per node type, schema propagation and inference, graph validation) and the React Flow workspace, matching every W09 board state by state. Include isValidConnection (cycles, ports, schemas), quick-add, connect-to-empty-pane, insert-on-edge, NodeToolbar, context menus, helper lines, elkjs layout, zundo undo/redo with the snapshot boundaries in SIMULATOR.md, copy/paste, autosave and the two-tab conflict check. Running the pipeline is M3; stub the run pill.

## Build now (MVP)
- **SIM-01** The gallery shows scenarios (fraud bursts, refunds matching, card velocity, merchant top-N, late payments) and blank. Loading a scenario has a skeleton state.
- **SIM-02** My pipelines: list, rename, duplicate, delete (with undo), import JSON (`IMPORT-INVALID`), and an empty state.
- **SIM-03** The palette is grouped into 6 categories with colours and descriptions. Search filters across categories; empty search shows "No nodes match". Drag onto the canvas, or press Enter to add at the viewport centre.
- **SIM-04** Quick-add: double-click the pane or press `/`. It opens at the cursor, keyboard-first; Enter inserts the node and connects it when started from a handle.
- **SIM-05** Dragging shows helper lines and snaps within 6 px to align with other nodes; snap grid 8.
- **SIM-06** Connecting: valid targets glow while dragging; invalid ones show a reason at the cursor and the edge is not created (`SIM-CYCLE`, `SIM-PORT-TYPE`).
- **SIM-07** Cycles, self-loops and duplicate edges are rejected.
- **SIM-08** Dropping a connection on empty pane opens quick-add there; the new node is auto-connected.
- **SIM-09** Insert on edge: "+" at the edge midpoint inserts and reconnects as one undo step.
- **SIM-10** Node toolbar (single selection): Configure, Run to here, Duplicate, Disable, Delete. Context menus for pane, node and edge.
- **SIM-11** Multi-select (shift-click, box), then move, delete, copy and paste with offset.
- **SIM-12** Undo/redo: ⌘Z / ⇧⌘Z, 100 steps, history popover with labels, jump to any step. Snapshot boundaries are as in SIMULATOR.md.
- **SIM-13** Auto-layout (elkjs) animates and can be undone in one step (toast with Undo).
- **SIM-14** Graph validation runs on every change: `SIM-NO-SOURCE`, `SIM-NO-SINK`, `SIM-DISCONNECTED`, `SIM-SCHEMA-DRIFT`, `SIM-UNION-SCHEMA`. Errors show on the node badge and in the Problems tab, and clicking a problem selects the node.
- **SIM-15** Run is blocked while errors exist, with a tooltip (`SIM-RUN-BLOCKED`).
- **SIM-16** Run controls: run, pause, step (one event), reset, speed (0.25×–10×), and Chaos (inject late, duplicate and bad events, plus a source stall).
- **SIM-17** While running: edges animate, counts on edges update at least 5×/s, the busiest node glows, and the watermark shows in the pill.
- **SIM-18** Runtime expression failures go to dead-letter and are counted on the node (`SIM-RUNTIME-EXPR`).
- **SIM-19** Engine crash or OOM: dialog, pipeline intact (`SIM-ENGINE-CRASH`).
- **SIM-20** Autosave within 500 ms and on unload. A two-tab conflict is detected (`SIM-TAB-CONFLICT`).
- **SIM-21** Run panel tabs: Timeline (watermark vs event time, window fires, late events), Output (per sink), Trace, Flink SQL (live export), Problems.
- **SIM-22** Minimap, zoom controls and fit view. The keyboard shortcuts sheet is reachable with `?`.
- **SIM-23** More than 150 nodes switches to performance mode (`SIM-LARGE-GRAPH`). On screens under 900 px wide, the builder is replaced by a read-only state (`SIM-SMALL-SCREEN`).
- **SIM-24** Deterministic: the same seed and pipeline give identical output (tested by snapshot).
- **SIM-25** Schema on every edge: JSON Schema inferred from the sample data, shown on edge hover and in the Input schema tab, editable (type, required, rename). Edits propagate downstream and re-run validation.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- (none)

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `B03-Node-library`: B03 Node library · categories, icons, states
- `W07-Gallery`: W07 New pipeline · scenario gallery
- `W07b-Gallery-loading`: W07 New pipeline · loading a scenario
- `W08-MyPipelines-empty`: W08 My pipelines · empty
- `W08b-MyPipelines-list`: W08 My pipelines · list
- `W08c-MyPipelines-import-error`: W08 My pipelines · import failed
- `W08d-MyPipelines-delete`: W08 My pipelines · delete confirm
- `W09-Workspace-empty`: W09 Workspace · empty canvas
- `W09b-Workspace-quick-add`: W09 Workspace · quick-add (double-click or /)
- `W09c-Workspace-dragging`: W09 Workspace · dragging with helper lines
- `W09d-Workspace-connecting`: W09 Workspace · connecting, valid target
- `W09e-Workspace-connect-invalid`: W09 Workspace · connecting, invalid target
- `W09f-Workspace-ready`: W09 Workspace · built, ready to run
- `W09g-Workspace-context-menu`: W09 Workspace · node selected, toolbar and menu
- `W09h-Workspace-insert-on-edge`: W09 Workspace · insert a node on an edge
- `W09i-Workspace-running`: W09 Workspace · running (animated edges, glowing node)
- `W09j-Workspace-paused`: W09 Workspace · paused, stepping one event
- `W09k-Workspace-finished`: W09 Workspace · finished, output tab
- `W09l-Workspace-error`: W09 Workspace · validation errors with alert
- `W09m-Workspace-history`: W09 Workspace · undo history
- `W09n-Workspace-undo-toast`: W09 Workspace · delete with undo
- `W09o-Workspace-auto-layout`: W09 Workspace · auto-layout applied
- `W09p-Workspace-command-palette`: W09 Workspace · command palette
- `WX02-Run-blocked`: WX02 Simulator · Run blocked, reason on hover
- `WX08-Two-tabs`: WX08 Same pipeline open in two tabs
- `WX09-Small-screen`: WX09 Simulator on a small screen
- `WX10-Large-graph`: WX10 Large pipeline · performance mode
- `WM03-node`: Motion · Node drop and edge connect

## Error codes this milestone must raise and test (15)
Full rows are in `docs/ERROR_CATALOG.md`.
- `SIM-NO-SOURCE` (error, Problems tab + Run tooltip): Add a Source to start the pipeline.
- `SIM-NO-SINK` (warning, object badge + Problems): {node} output goes nowhere. Events will be dropped.
- `SIM-DISCONNECTED` (error, object badge + Problems): {node} has no input.
- `SIM-CYCLE` (error, inline at cursor while dragging (connection refused)): This would make a loop. Streams must flow one way.
- `SIM-PORT-TYPE` (error, inline at cursor (refused)): Schemas do not match: {a} has {fields}, {b} needs {fields}.
- `SIM-SCHEMA-DRIFT` (error, object badge + Problems + field error in drawer): {node} uses "{field}", which {upstream} no longer outputs.
- `SIM-RUN-BLOCKED` (error, Run button tooltip + Problems tab opens): Fix {n} error(s) to run.
- `SIM-SLOW` (info, toast): Running slower than {speed}. Try fewer events.
- `SIM-RUNTIME-EXPR` (warning, node badge count + Problems row + event marked in Timeline): {n} events failed in {node}: {reason}. They were sent to Dead-letter.
- `SIM-DELETE-UNDO` (success, toast with Undo (8 s)): Deleted {n} node(s).
- `SIM-UNDO-EMPTY` (info, button disabled + tooltip): Nothing to undo.
- `SIM-TAB-CONFLICT` (warning, banner): This pipeline is open in another tab, which saved a newer version.
- `SIM-SMALL-SCREEN` (info, full-page state): The builder needs a wider screen. You can watch scenarios and read the course.
- `SIM-LARGE-GRAPH` (info, toast): Edge animation and live counts are reduced to keep it smooth.
- `IMPORT-INVALID` (error, dialog): {file} could not be imported: {reason}.

## Before you write code
1. Restate the scope: the criteria IDs you will build now, and the ones you will only prepare for.
2. For each component, name the board state it matches.
3. If two docs conflict, stop and ask. Otherwise follow the docs; do not ask about things they answer.

## While working
- Small commits (conventional). Tests are named `<ID> …` or `<ERROR-CODE> …`.
- No dependency outside the CLAUDE.md stack without a one-line reason in the PR.
- Every user-visible problem uses a catalog code. A new case means a new catalog row in the same PR.

## Done when
- Every "Build now" criterion and every listed error code has a passing test.
- Each listed board matches at 1440×900 and 1280×800: states, spacing, type, colours, motion and reduced motion.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` pass, with axe showing 0 violations.
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
