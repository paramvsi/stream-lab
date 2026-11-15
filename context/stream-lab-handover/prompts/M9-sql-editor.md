# M9 · SQL editor (Phase 3 (whole milestone is v1))

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/SQL_EDITOR.md`, docs/FLINK_API.md (SQL Gateway), `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build the CodeMirror 6 editor with the three validation layers (local, catalog, gateway EXPLAIN), hover cards, Problems tab, quick fixes and Fix all as one undo. Add results streaming with changelog ops and the 10k cap, the plan graph, saved queries and snippets, receiving pipelines from the website, and the gateway session lifecycle (heartbeat, expiry, connection loss).

## Build now (MVP)
- (none)

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **SQL-01** Everything in SQL_EDITOR.md, including the three validation layers, hover cards, Problems tab and quick fixes.
- **SQL-02** Run at cursor / Run all / Stop, streaming results, changelog ops, 10k row cap, plan view.
- **SQL-03** Gateway session lifecycle: heartbeat, expiry recovery, connection-loss recovery.
- **SQL-05** (v1) Plan view: EXPLAIN output drawn as a graph.
- **SQL-06** (v1) Saved queries and snippets, per connection or for any connection (`SQL-SAVE-CONFLICT`, X16).
- **SQL-07** (v1) Receive pipelines sent from the website and deploy them as SQL.
- **SQL-04** (v1) Multiple tabs per connection; drafts autosave; a dialog warns about unsaved changes on close (`APP-UNSAVED`).

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `D17-SQL-empty`: D17 SQL editor (v1) · empty
- `D17-SQL-run`: D17 SQL editor (v1) · streaming results
- `D17-SQL-err`: D17 SQL editor (v1) · error
- `D17-SQL-plan`: D17 SQL editor (v1) · plan view
- `D17-SQL-incoming`: D17 SQL editor (v1) · pipeline from simulator
- `D17-SQL-nogw`: D17 SQL editor (v1) · no SQL Gateway
- `X01-SQL-syntax-error`: X01 SQL · syntax error, inline
- `X02-SQL-unknown-table`: X02 SQL · unknown table with quick fix
- `X03-SQL-warning-state`: X03 SQL · warning, unbounded state
- `X04-SQL-problems-list`: X04 SQL · several problems, Run blocked
- `X05-SQL-runtime-failure`: X05 SQL · statement failed after submit
- `X06-SQL-gateway-lost`: X06 SQL · gateway connection lost while streaming
- `X07-SQL-truncated`: X07 SQL · results capped (info)
- `X16-SQL-saved-queries`: X16 SQL · saved queries and snippets

## Error codes this milestone must raise and test (15)
Full rows are in `docs/ERROR_CATALOG.md`.
- `SQL-SAVE-CONFLICT` (warning, inline banner): Saving "{name}" will replace the saved version from {ago}.
- `SQL-NO-GATEWAY` (info, full-page state): SQL needs the Flink SQL Gateway (port 8083). Add its address to this connection.
- `SQL-PARSE` (error, inline (squiggle + gutter + hover) + Problems tab): Syntax error at line {l}: {expected}.
- `SQL-UNKNOWN-TABLE` (error, inline + Problems): Table "{t}" not found in {catalog}.{db}. Did you mean "{s}"?
- `SQL-UNKNOWN-COLUMN` (error, inline + Problems): Column "{c}" not found in {t}. Did you mean "{s}"?
- `SQL-TYPE` (error, inline + Problems): Cannot apply {fn} to {type}.
- `SQL-WINDOW-GROUP` (warning, inline + Problems): GROUP BY must include window_start and window_end for this window aggregate.
- `SQL-STATE-TTL` (warning, inline + Problems): This {op} keeps state forever. Set a state TTL or use an interval/window join.
- `SQL-MULTI-STMT` (info, inline): Running the statement at the cursor (line {l}).
- `SQL-RUN-BLOCKED` (error, inline next to Run + tooltip): Fix {n} error(s) to run.
- `SQL-RUNTIME` (error, banner above results): The statement started, then failed after {dur}: {cause}.
- `SQL-SESSION-EXPIRED` (warning, banner): The SQL session expired. A new one was opened; SET options were re-applied.
- `SQL-GATEWAY-LOST` (warning, banner + dimmed results + status badge): Lost connection to the SQL Gateway. The query may still be running. Reconnecting in {s} s.
- `SQL-TRUNCATED` (info, banner): Showing the latest {n} rows. Older rows were dropped from the view; the query is unaffected.
- `SQL-CANCELLED` (success, toast): Query stopped.

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
- Each of X01–X07 has an e2e test against docker Flink 2.x.
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
