# M3 · Engine and run (Phase 1)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then docs/ARCHITECTURE.md (engine semantics, FlinkClient line), docs/SIMULATOR.md (run states), `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build packages/engine as a Web Worker with the Flink-matching semantics listed in ARCHITECTURE.md, the SimulatorClient side of the FlinkClient interface, the run pill and the run panel tabs, the seeded generator with chaos, CSV/JSONL upload, the fintech data pack and reference tables (versioned). Batched stats every 100 ms; never one message per event.

## Build now (MVP)
- **SIM-16** Run controls: run, pause, step (one event), reset, speed (0.25×–10×), and Chaos (inject late, duplicate and bad events, plus a source stall).
- **SIM-17** While running: edges animate, counts on edges update at least 5×/s, the busiest node glows, and the watermark shows in the pill.
- **SIM-18** Runtime expression failures go to dead-letter and are counted on the node (`SIM-RUNTIME-EXPR`).
- **SIM-19** Engine crash or OOM: dialog, pipeline intact (`SIM-ENGINE-CRASH`).
- **SIM-21** Run panel tabs: Timeline (watermark vs event time, window fires, late events), Output (per sink), Trace, Flink SQL (live export), Problems.
- **SIM-24** Deterministic: the same seed and pipeline give identical output (tested by snapshot).
- **DATA-01** Generator settings are validated (`GEN-INVALID`). The seed is shown and can be copied.
- **DATA-02** CSV/JSONL upload: progress, preview of the first 20 rows, column mapping to the source schema, bad-row report (`DATA-PARSE`, `DATA-SCHEMA`), and a 200 MB limit (`DATA-TOO-LARGE`).
- **DATA-03** Reference tables: create, edit, import; versioned tables with valid-from for temporal lookups.
- **DATA-05** Fintech payments pack (MVP): card and wallet transactions, merchants, FX rates (versioned), a blocklist, and built-in fraud patterns (bursts, card testing, impossible travel).
- **DATA-04** Storage: show usage; handle quota full (`STORE-FULL`) and blocked storage (`STORE-BLOCKED`).
- **ENG-01** Runs in a Web Worker; the page stays responsive. 10,000 events replay in under 2 s on a mid-range laptop.
- **ENG-02** Event time: watermarks (bounded out-of-orderness), idleness, allowed lateness, late-data side output.
- **ENG-03** Keyed state and parallelism: simulated subtasks, key groups (max parallelism 128) and hash partitioning. The stage inspector shows the subtask per key.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **DATA-06** E-commerce pack (v1): clickstream, carts, orders, inventory.
- **ENG-04** (v1) Changelog semantics: +I, -U, +U, -D through aggregations and joins.
- **ENG-05** (v1) Checkpoints and backpressure: simulated barriers and bounded buffers. A slow sink shows backpressure upstream.
- **ENG-06** (v1) Fidelity tests: golden outputs for each scenario compared with real Flink runs (docker) in CI. The simulator says it models Flink and is not Flink.

## Later: do not build
- **DATA-07** PaySim import (Later).

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `W09i-Workspace-running`: W09 Workspace · running (animated edges, glowing node)
- `W09j-Workspace-paused`: W09 Workspace · paused, stepping one event
- `W09k-Workspace-finished`: W09 Workspace · finished, output tab
- `W09l-Workspace-error`: W09 Workspace · validation errors with alert
- `W12-Data-generator`: W12 Data · generator settings
- `W12b-Data-upload`: W12 Data · uploading a file
- `W12c-Data-upload-error`: W12 Data · upload has bad rows
- `W13-RefTables`: W13 Reference tables · list
- `W13b-RefTables-versioned`: W13 Reference tables · versioned table
- `WX03-Engine-crash`: WX03 Simulator · engine stopped unexpectedly
- `WX04-Storage-full`: WX04 Browser storage full
- `WX06-File-too-large`: WX06 Upload too large
- `WM01-wm`: Motion · Watermark sweep and window fire
- `WM02-late`: Motion · Late event to side output
- `WM06-running`: Motion · running pipeline

## Error codes this milestone must raise and test (13)
Full rows are in `docs/ERROR_CATALOG.md`.
- `SIM-NO-SOURCE` (error, Problems tab + Run tooltip): Add a Source to start the pipeline.
- `SIM-NO-SINK` (warning, object badge + Problems): {node} output goes nowhere. Events will be dropped.
- `SIM-DISCONNECTED` (error, object badge + Problems): {node} has no input.
- `SIM-SCHEMA-DRIFT` (error, object badge + Problems + field error in drawer): {node} uses "{field}", which {upstream} no longer outputs.
- `SIM-ENGINE-CRASH` (error, dialog): The simulator stopped at event {n}: {reason}. Your pipeline is safe.
- `SIM-SLOW` (info, toast): Running slower than {speed}. Try fewer events.
- `SIM-RUNTIME-EXPR` (warning, node badge count + Problems row + event marked in Timeline): {n} events failed in {node}: {reason}. They were sent to Dead-letter.
- `DATA-PARSE` (warning, panel (upload) with row list): {n} of {total} rows could not be read (first: line {l}: {reason}).
- `DATA-SCHEMA` (error, panel): Column "{c}" is missing; the Source schema needs it.
- `DATA-TOO-LARGE` (error, panel): {file} is {size}. The simulator handles up to 200 MB per file.
- `GEN-INVALID` (error, field): {reason}.
- `STORE-FULL` (error, banner (persistent)): Can not save: browser storage is full ({used}).
- `STORE-BLOCKED` (warning, banner): This browser is not letting Stream Lab save. Work will be lost when you close the tab.

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
- Performance: 10,000 events in under 2 s (ENG-01). Determinism snapshot test (SIM-24).
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
