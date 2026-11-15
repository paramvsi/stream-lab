# M2 · Node drawers (Phase 1)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/NODES.md`, `docs/SIMULATOR.md`, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build the bottom drawer (resizable, collapsible, focus-managed) and the forms generated from each node's zod schema, for every MVP node type. Build the CEL editor with autocomplete, inline diagnostics and quick fixes, and the live 5-event preview. Previews can use a synchronous mini-engine until M3 lands.

## Build now (MVP)
- **NODE-01** Clicking a node (or Enter on a focused node) opens the bottom drawer, which slides up. Tabs: Settings, Input schema, Output preview, Docs.
- **NODE-02** The form is generated from the node's zod schema. Errors are inline, and the node badge updates live.
- **NODE-03** Expression fields (CEL) get syntax highlighting, field autocomplete from the input schema, and inline errors with quick fix (`CEL-*`).
- **NODE-04** The live preview shows 5 sample events before and after the node. Stateful nodes show state per key.
- **NODE-05** "Run to here" runs the pipeline up to this node and shows its output.
- **NODE-06** Every node type in NODES.md (including Union) is implemented, with its validation codes.
- **NODE-07** Config edits are snapshotted on blur, so undo restores the previous value. The drawer can be resized and collapsed. Esc closes it and returns focus to the node.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **NODE-08** The SQL node runs free SQL over the stream with DuckDB-WASM (v1), loaded lazily on first use. Unsupported syntax gives `SQLNODE-UNSUPPORTED`.

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `W10-Source`: W10 Node config · Source
- `W10-Filter`: W10 Node config · Filter
- `W10-Map`: W10 Node config · Map
- `W10-Validate`: W10 Node config · Validate · rule error
- `W10-Lookup`: W10 Node config · Lookup
- `W10-Window`: W10 Node config · Window
- `W10-Join`: W10 Node config · Join
- `W10-Dedup`: W10 Node config · Deduplicate
- `W10-TopN`: W10 Node config · Top-N
- `W10-Route`: W10 Node config · Route
- `W10-Sink`: W10 Node config · Sink
- `W10-DLQ`: W10 Node config · Dead-letter
- `W10-Pattern`: W10 Node config · Pattern (v1)
- `W10-SQLNode`: W10 Node config · SQL node (v1)
- `W10x-Window-schema`: W10 Node config · Window, input schema tab
- `W10y-Window-preview`: W10 Node config · Window, output preview with state per key
- `W10z-Window-docs`: W10 Node config · Window, docs tab
- `WX01-CEL-error`: WX01 Simulator · CEL rule error inline

## Error codes this milestone must raise and test (15)
Full rows are in `docs/ERROR_CATALOG.md`.
- `SIM-UNION-SCHEMA` (error, object badge + field): Union inputs must match. {a} has {x}; {b} has {y}.
- `NODE-REQUIRED` (error, field + node badge): {field} is required.
- `CEL-PARSE` (error, inline in expression editor + node badge): Expression error at column {c}: {reason}.
- `CEL-UNKNOWN-FIELD` (error, inline + quick fix): Unknown field "{f}". Fields here: {list}.
- `CEL-TYPE` (error, inline): This must return {expected}; it returns {actual}.
- `WIN-SIZE` (error, field): {reason}.
- `WIN-NO-TIME` (error, field + node badge): Pick an event-time field on {source}, or switch to processing time.
- `WM-LATENESS-BIG` (warning, field): Lateness of {x} keeps windows open a long time and holds state.
- `LOOKUP-NO-TABLE` (error, field): Reference table "{t}" is empty or missing.
- `LOOKUP-KEY-TYPE` (error, field): Key types differ: {a} vs {b}.
- `JOIN-NO-BOUND` (warning, field + node badge): Unbounded join: state grows forever. Set a time bound.
- `DEDUP-NO-TTL` (warning, field): Without a TTL, every key is remembered forever.
- `PATTERN-INVALID` (error, field): Step {n}: {reason}.
- `ROUTE-OVERLAP` (warning, field): No default branch: events matching no rule are dropped.
- `SQLNODE-UNSUPPORTED` (error, inline): The simulator does not support {feature}. It will work on a real cluster; export to try it.

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
