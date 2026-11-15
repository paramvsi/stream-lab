# Architecture

```
pnpm workspaces + turborepo
apps/
  web/        Vite SPA, static deploy (Cloudflare Pages / GitHub Pages). Routes via TanStack Router.
  desktop/    Tauri 2. src-tauri/ (Rust) + src/ (React, reuses packages/*). Desktop-only routes.
packages/
  ui/         components built on Radix + tokens.css. Storybook with one story per board state.
  errors/     AppError, generated catalog.ts, present(), mappers, <FieldError/> <Banner/> <ProblemsPanel/> <Toast/>
  graph/      Pipeline model (versioned JSON), zod schema per node, schema propagation, graph validation, SQL export
  engine/     Worker: event-time simulation, watermarks, windows, state, side outputs, lineage (explain mode)
  flink/      Typed client: endpoints/*.ts + zod; invoke('flink_request'); polling scheduler; capability table
  sql/        Tokenizer, splitter, local lint rules, gateway-error → range mapping, CodeMirror extensions
  course/     MDX chapters + challenge checkers (pure functions over engine output)
docker/       Flink 1.20/2.0/2.2/2.3 compose files, proxy/TLS/mTLS variants, Kafka, sample data loader
```

## The FlinkClient line (from the original plan)
Everything above one `FlinkClient` interface is written once. Below it there are two implementations:
- `SimulatorClient` for the site, backed by the engine worker. It answers the same job, vertex, checkpoint and metrics shapes, so the job graph, operator panel and timelines are reused for the simulator.
- `HttpClient` for the desktop app, backed by the Rust `flink_request` command. The original plan said Tauri's HTTP plugin; we use our own command on top of it so that auth, TLS, tunnels and redaction all live in Rust.

Storage: IndexedDB on the site; SQLite in the desktop app for history, saved views, saved queries, run configurations and alerts.

## Website data flow
UI (React Flow + drawers) ⇄ **graph store** (Zustand + zundo) → validate (graph pkg) → **engine worker** (postMessage: graph, data config) → batched stats (100 ms) → **run store** (separate from graph store) → node/edge labels, run panel.
Persistence: IndexedDB `pipelines` (versioned, `schemaVersion` + migrations), `refTables`, `uploads` (OPFS handles), `progress`. BroadcastChannel `streamlab` for multi-tab.

## Pipeline JSON (v1)
```json
{ "schemaVersion": 1, "id": "p_…", "name": "Card bursts", "updatedAt": "…", "seed": 42,
  "nodes": [{ "id": "n1", "type": "Source", "position": {"x":0,"y":0}, "config": {…}, "disabled": false }],
  "edges": [{ "id": "e1", "source": "n1", "sourceHandle": "main", "target": "n2", "targetHandle": "main" }],
  "data": { "generator": {…}, "refTables": ["merchants"] }, "viewport": {"x":0,"y":0,"zoom":1} }
```
Migrations are pure functions `vN → vN+1`, tested with fixtures. Importing a newer version → `IMPORT-INVALID` ("made with a newer Stream Lab").

## Engine semantics (must match Flink)
- Event time per event; watermark = max(event time) − out-of-orderness, per source split, min across inputs; idle timeout excludes idle splits.
- Windows fire when watermark ≥ window end − 1 ms; allowed lateness keeps state; later events → `late` side output.
- Keyed state per key; TTL by processing time of the simulation clock.
- Interval join, lookup (as-of versioned table), dedup (keep first/last), top-N per window, pattern (subset of MATCH_RECOGNIZE semantics: strict/relaxed contiguity, times, within).
- Deterministic: seeded PRNG, stable ordering by (event time, source, sequence).
Each semantic has a unit test referencing the Flink doc section.

## Desktop
- Rust commands: `flink_request`, `secret_get/set/delete` (keychain), `tunnel_open/close` (ssh, kubectl), `cert_fetch` (for trust dialog), `file_read_pem`, `deep_link_payload`.
- State: TanStack Query cache per connection (keys `[connId, …]`); connection list in Tauri store (no secrets); SQL drafts in store; alert rules + fired alerts in SQLite (`tauri-plugin-sql`).
- Deep link `streamlab://import?p=<base64url gz pipeline>` → opens "Imported from website" with SQL preview, choose connection.
- Background: polling continues while the window is hidden only for alert-rule queries (setting).

## Security
CSP strict (no remote scripts), Tauri capabilities least-privilege (http only via our command; fs scoped to chosen files), updater signature verification, no telemetry by default, secrets only in keychain, redact in logs and "Copy details".
