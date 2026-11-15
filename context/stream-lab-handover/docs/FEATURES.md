# Features and acceptance criteria

Each criterion has an ID. Tests reference the ID in their name, e.g. `it('SIM-07 rejects a cycle …')`. **Priority (MVP / v1 / Later) comes from the original feature list. See `TRACEABILITY.md`, which maps all 77 original features to these criteria.** A feature is done when all of its criteria pass.

---
## Website

### LAND · Landing and site (W01–W03)
- LAND-01 The hero pipeline animates on load: events flow, the window fires, output rows appear. It shows a still frame under reduced motion.
- LAND-02 The primary CTA "Start building" opens the scenario gallery; the secondary CTA "Take the course" opens /learn.
- LAND-03 The download section detects the OS and highlights the right installer (W02 mac/win/linux). The other installers are listed under it.
- LAND-04 Sections animate in on scroll with the stagger tokens, once each, not on every scroll.
- LAND-05 An unknown route shows the 404 page (W03) with links to the course and the simulator.
- LAND-06 Lighthouse scores: performance ≥ 90, accessibility = 100, on mobile and desktop.

### LEARN · Course (W04–W06)
- LEARN-01 There are 10 chapters. Progress is saved in IndexedDB. The course page shows new, in-progress and done states.
- LEARN-02 A chapter has reading, a sandbox (an embedded mini simulator) and a challenge.
- LEARN-03 A challenge checker returns pass/fail and a hint (`COURSE-WRONG`). Passing marks the chapter done and shows a dialog.
- LEARN-05 Chapters, in this order: 1 Event time vs processing time · 2 Watermarks and late events · 3 Windows · 4 Aggregations and Top-N · 5 Deduplication · 6 Joins and versioned lookups (MVP); 7 State and TTL · 8 Pattern detection (MATCH_RECOGNIZE) · 9 Changelogs and retractions (FROM_CHANGELOG / TO_CHANGELOG, Flink 2.3) · 10 Checkpoints, exactly-once and backpressure (v1).
- LEARN-04 Concept links open a glossary drawer, and you can open it without leaving the chapter. Glossary search covers names and aliases, and has an empty state.

### SIM · Pipeline building (W07–W09, B03)
- SIM-01 The gallery shows scenarios (fraud bursts, refunds matching, card velocity, merchant top-N, late payments) and blank. Loading a scenario has a skeleton state.
- SIM-02 My pipelines: list, rename, duplicate, delete (with undo), import JSON (`IMPORT-INVALID`), and an empty state.
- SIM-03 The palette is grouped into 6 categories with colours and descriptions. Search filters across categories; empty search shows "No nodes match". Drag onto the canvas, or press Enter to add at the viewport centre.
- SIM-04 Quick-add: double-click the pane or press `/`. It opens at the cursor, keyboard-first; Enter inserts the node and connects it when started from a handle.
- SIM-05 Dragging shows helper lines and snaps within 6 px to align with other nodes; snap grid 8.
- SIM-06 Connecting: valid targets glow while dragging; invalid ones show a reason at the cursor and the edge is not created (`SIM-CYCLE`, `SIM-PORT-TYPE`).
- SIM-07 Cycles, self-loops and duplicate edges are rejected.
- SIM-08 Dropping a connection on empty pane opens quick-add there; the new node is auto-connected.
- SIM-09 Insert on edge: "+" at the edge midpoint inserts and reconnects as one undo step.
- SIM-10 Node toolbar (single selection): Configure, Run to here, Duplicate, Disable, Delete. Context menus for pane, node and edge.
- SIM-11 Multi-select (shift-click, box), then move, delete, copy and paste with offset.
- SIM-12 Undo/redo: ⌘Z / ⇧⌘Z, 100 steps, history popover with labels, jump to any step. Snapshot boundaries are as in SIMULATOR.md.
- SIM-13 Auto-layout (elkjs) animates and can be undone in one step (toast with Undo).
- SIM-14 Graph validation runs on every change: `SIM-NO-SOURCE`, `SIM-NO-SINK`, `SIM-DISCONNECTED`, `SIM-SCHEMA-DRIFT`, `SIM-UNION-SCHEMA`. Errors show on the node badge and in the Problems tab, and clicking a problem selects the node.
- SIM-15 Run is blocked while errors exist, with a tooltip (`SIM-RUN-BLOCKED`).
- SIM-16 Run controls: run, pause, step (one event), reset, speed (0.25×–10×), and Chaos (inject late, duplicate and bad events, plus a source stall).
- SIM-17 While running: edges animate, counts on edges update at least 5×/s, the busiest node glows, and the watermark shows in the pill.
- SIM-18 Runtime expression failures go to dead-letter and are counted on the node (`SIM-RUNTIME-EXPR`).
- SIM-19 Engine crash or OOM: dialog, pipeline intact (`SIM-ENGINE-CRASH`).
- SIM-20 Autosave within 500 ms and on unload. A two-tab conflict is detected (`SIM-TAB-CONFLICT`).
- SIM-21 Run panel tabs: Timeline (watermark vs event time, window fires, late events), Output (per sink), Trace, Flink SQL (live export), Problems.
- SIM-22 Minimap, zoom controls and fit view. The keyboard shortcuts sheet is reachable with `?`.
- SIM-23 More than 150 nodes switches to performance mode (`SIM-LARGE-GRAPH`). On screens under 900 px wide, the builder is replaced by a read-only state (`SIM-SMALL-SCREEN`).
- SIM-24 Deterministic: the same seed and pipeline give identical output (tested by snapshot).
- SIM-25 Schema on every edge: JSON Schema inferred from the sample data, shown on edge hover and in the Input schema tab, editable (type, required, rename). Edits propagate downstream and re-run validation.

### NODE · Node configuration (W10*)
- NODE-01 Clicking a node (or Enter on a focused node) opens the bottom drawer, which slides up. Tabs: Settings, Input schema, Output preview, Docs.
- NODE-02 The form is generated from the node's zod schema. Errors are inline, and the node badge updates live.
- NODE-03 Expression fields (CEL) get syntax highlighting, field autocomplete from the input schema, and inline errors with quick fix (`CEL-*`).
- NODE-04 The live preview shows 5 sample events before and after the node. Stateful nodes show state per key.
- NODE-05 "Run to here" runs the pipeline up to this node and shows its output.
- NODE-06 Every node type in NODES.md (including Union) is implemented, with its validation codes.
- NODE-08 The SQL node runs free SQL over the stream with DuckDB-WASM (v1), loaded lazily on first use. Unsupported syntax gives `SQLNODE-UNSUPPORTED`.
- NODE-07 Config edits are snapshotted on blur, so undo restores the previous value. The drawer can be resized and collapsed. Esc closes it and returns focus to the node.

### DATA · Data and reference tables (W12–W13)
- DATA-01 Generator settings are validated (`GEN-INVALID`). The seed is shown and can be copied.
- DATA-02 CSV/JSONL upload: progress, preview of the first 20 rows, column mapping to the source schema, bad-row report (`DATA-PARSE`, `DATA-SCHEMA`), and a 200 MB limit (`DATA-TOO-LARGE`).
- DATA-03 Reference tables: create, edit, import; versioned tables with valid-from for temporal lookups.
- DATA-05 Fintech payments pack (MVP): card and wallet transactions, merchants, FX rates (versioned), a blocklist, and built-in fraud patterns (bursts, card testing, impossible travel).
- DATA-06 E-commerce pack (v1): clickstream, carts, orders, inventory.
- DATA-07 PaySim import (Later).
- DATA-04 Storage: show usage; handle quota full (`STORE-FULL`) and blocked storage (`STORE-BLOCKED`).

### ENG · Simulator engine (packages/engine)
- ENG-01 Runs in a Web Worker; the page stays responsive. 10,000 events replay in under 2 s on a mid-range laptop.
- ENG-02 Event time: watermarks (bounded out-of-orderness), idleness, allowed lateness, late-data side output.
- ENG-03 Keyed state and parallelism: simulated subtasks, key groups (max parallelism 128) and hash partitioning. The stage inspector shows the subtask per key.
- ENG-04 (v1) Changelog semantics: +I, -U, +U, -D through aggregations and joins.
- ENG-05 (v1) Checkpoints and backpressure: simulated barriers and bounded buffers. A slow sink shows backpressure upstream.
- ENG-06 (v1) Fidelity tests: golden outputs for each scenario compared with real Flink runs (docker) in CI. The simulator says it models Flink and is not Flink.

### EXPL · Tour and explain (T01–T06, E01–E09)
- EXPL-01 The tour starts automatically on the first visit to the simulator (it can be skipped) and later from the header. It has 5 action-based steps with a spotlight, and is completed once.
- EXPL-02 Explain this run: pick an output row or a random event. Step through its path with the dim/highlight, step badges and a narration that uses real values. Keys ←/→, Esc to exit.
- EXPL-03 Trace: select any output row and the canvas highlights the contributing inputs and nodes.
- EXPL-04 (v1) What-if compare (change a setting, rerun, diff the output) and expected outputs as tests (pin a result, pass/fail on later edits). E07–E09.
- EXPL-05 Time scrubber: event-time axis with the watermark line and window boundaries. Dragging it moves the replay.
- EXPL-06 Stage inspector: in, out, dropped and late counts per node, and state contents per key.

### EXP · Export and share (W17–W18)
- EXP-01 Flink SQL export covers sources, filters, maps, windows (TVF), joins (interval), lookups (FOR SYSTEM_TIME AS OF), dedup (ROW_NUMBER), top-N, pattern (MATCH_RECOGNIZE) and sinks. Unsupported nodes get a TODO comment (`EXPORT-UNSUPPORTED`).
- EXP-02 The docker-compose bundle runs the exported SQL on a local Flink + Kafka, with a README.
- EXP-03 Send to desktop: the `streamlab://import?…` deep link opens the app; a timeout shows the fallback (`DESKTOP-NOT-FOUND`).
- EXP-04 Share link: the pipeline is compressed into the URL hash, with no server. A warning appears over 8,000 characters (`SHARE-TOO-LONG`). Opening the link gives a read-only copy with "Make a copy", and a broken link shows `SHARE-BROKEN`.

---
## Desktop app

### INST · Install and first run (I01–I06, D01)
- INST-01 Signed installers: .dmg (universal), .msi/.exe, .AppImage/.deb/.rpm. The splash appears in under 1 s.
- INST-02 The welcome screen offers Add a connection, Import, and a docker compose hint.

### CONN · Connections (D02–D03, C01–C07)
- CONN-01 The wizard asks where the cluster runs first (C01), then shows the form for that platform.
- CONN-02 Every field validates on blur and on save (`CONN-URL-INVALID`, `CONN-NAME-TAKEN`, `CONN-REQUIRED`, `CONN-MTLS-FILE`, `CONN-HEADER-AUTH`).
- CONN-03 Auth types: none, basic, bearer, token command, mTLS, custom headers. Secrets go to the keychain only (`CONN-KEYCHAIN`).
- CONN-04 Transports: direct and HTTP proxy. Advanced settings: base path, timeouts, poll interval, separate gateway address and login.
- CONN-05 Test connection runs the 7 steps from FLINK_API.md, live, with an exact result per step (C04). A partial pass offers "Save as read-only".
- CONN-06 (v1) Certificate trust dialog with fingerprint; pinned certs; changed-cert warning (`CONN-CERT-*`).
- CONN-07 Version detection adapts the UI. Hidden features are explained (C05).
- CONN-08 Import and export connections as JSON without secrets (`CONN-IMPORT-*`). Delete asks for confirmation.
- CONN-09 Environment tags (prod/staging/dev), colour-coded everywhere. A read-only flag hides actions.
- CONN-12 (v1) Tunnels: an SSH tunnel, or a Kubernetes port-forward from a kube context, namespace and service (D02g, D02h).
- CONN-11 (v1) A verify-TLS switch with a persistent warning (`CONN-TLS-VERIFY-OFF`, C08). It is not allowed on Production connections.
- CONN-10 Lost contact, offline, HA failover and expired managed links are handled (`CONN-LOST`, `CONN-OFFLINE`, `CONN-HA-FAILOVER`, `CONN-LINK-EXPIRED`).

### FLEET · Fleet and cluster (D04–D06)
- FLEET-01 The fleet grid shows every connection with health, running/failed jobs and slots, with loading, unreachable and offline states.
- FLEET-02 Cluster pages: overview KPIs and charts, TaskManagers list and detail, JobManager config, Applications (2.3+).

### JOB · Jobs (D07–D14)
- JOB-01 Jobs list: filter by state, search, sort, with empty and loading states.
- JOB-02 Job overview: graph with per-operator backpressure and watermark badges, KPIs, and states for healthy, backpressure, restarting, finished, read-only and explain.
- JOB-03 Operator panel: metrics charts, watermarks, subtasks with skew.
- JOB-04 History, exceptions (root cause first, full trace copyable), checkpoints (failing state), savepoints list.
- JOB-14 (v1) Config compare: a job's config against another job, cluster or earlier version (D13).
- JOB-05 Status changes raise the right codes (`JOB-*`).
- JOB-06 Local history (MVP): metrics, checkpoints, restarts and rescales stored in SQLite while the app is open, shown on a timeline. Retention and size limit are set in Settings (`HISTORY-FULL`).
- JOB-07 (v1) Watermark lag: each operator's watermark against wall-clock time, and which input holds it back.
- JOB-08 Grouped exceptions (MVP): collapsed by type and message, with count and first/last seen; expand to each occurrence (X20).
- JOB-09 (v1) Restart and rescale timeline, using `/jobs/:jid/rescales/overview` and `/history` on 2.3+.
- JOB-10 Explain this (MVP): a plain-language hint on each warning signal, linked to the matching chapter.
- JOB-11 Saved views and a cross-cluster job list (`FLEET-PARTIAL` when some connections do not answer) (X18).
- JOB-12 Checkpoint dashboard (MVP): duration, size, alignment time and failures over time, with the slowest operator flagged.
- JOB-13 (v1) Savepoint catalogue: savepoints seen or triggered per job; copy the path; restore.

### ACT · Job actions (D15–D16)
- ACT-01 Stop with savepoint: folder prefilled from the config or required (`SP-DIR-MISSING`), a drain option, a progress state, success and failure (`SP-FAILED`, `SP-TIMEOUT`).
- ACT-02 Trigger a savepoint without stopping. Cancel needs type-to-confirm on prod (`CANCEL-PROD`).
- ACT-03 Rescale: slot check (`RESCALE-SLOTS`), and a fallback when the scheduler is not adaptive (`RESCALE-UNSUPPORTED`).
- ACT-04 Submit JAR wizard: upload, configure, run, then ok or error, with all `SUBMIT-*` codes. Restore from savepoint, with "allow non-restored state".
- ACT-06 (v1) Saved run configurations for submit, which check that the savepoint still exists (`SUBMIT-SP-MISSING`, X17).
- ACT-05 Conflicts are detected (`API-409`). None of these calls is retried automatically.

### SQL · SQL editor (D17, X01–X07)
- SQL-01 Everything in SQL_EDITOR.md, including the three validation layers, hover cards, Problems tab and quick fixes.
- SQL-02 Run at cursor / Run all / Stop, streaming results, changelog ops, 10k row cap, plan view.
- SQL-03 Gateway session lifecycle: heartbeat, expiry recovery, connection-loss recovery.
- SQL-05 (v1) Plan view: EXPLAIN output drawn as a graph.
- SQL-06 (v1) Saved queries and snippets, per connection or for any connection (`SQL-SAVE-CONFLICT`, X16).
- SQL-07 (v1) Receive pipelines sent from the website and deploy them as SQL.
- SQL-04 (v1) Multiple tabs per connection; drafts autosave; a dialog warns about unsaved changes on close (`APP-UNSAVED`).

### OPS · Logs, profiling and alerts (D18–D20)
- OPS-01 Logs: JM/TM, follow, filter, regex (`LOG-REGEX`), large-file handling (`LOG-TOO-LARGE`).
- OPS-02 Thread dump, and flame graph (`PROFILER-OFF` when disabled).
- OPS-04 (Later) Flame graph and profiler results shown in the app with search (D19b is designed).
- OPS-05 (Later) Webhook alerts (Slack or any URL).
- OPS-03 Alert rules: create/edit/delete, validated (`ALERT-RULE-INVALID`); fire once and re-arm; mute; OS notifications (`ALERT-NOTIFY-DENIED`).

### APP · Global (G01–G05, D21, X13–X15)
- APP-01 Command palette (⌘K) covering every navigation and action, with a shortcuts sheet.
- APP-02 Auto-update: banner, dialog, progress, failure (`UPDATE-FAILED`).
- APP-03 Crash recovery restores tabs (`APP-CRASH-RECOVERED`).
- APP-04 Settings: appearance (light only in v1), polling, notifications, data and privacy (no telemetry by default), about.
