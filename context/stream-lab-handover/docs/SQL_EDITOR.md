# SQL editor (desktop): validation and states

Boards: `D17-*` (base states), `X01`–`X07` (diagnostics). Codes: `SQL-*` in ERROR_CATALOG.

## Editor
CodeMirror 6 with `@codemirror/lang-sql` (dialect: custom Flink keywords incl. `TUMBLE`, `HOP`, `CUMULATE`, `SESSION`, `DESCRIPTOR`, `MATCH_RECOGNIZE`, `FOR SYSTEM_TIME AS OF`, `WATERMARK FOR`), autocomplete from catalog cache, `@codemirror/lint` for diagnostics, multi-tab with autosave of drafts (Tauri store, per connection).

## Diagnostic model
```ts
interface Diagnostic { code: ErrorCode; severity: 'error' | 'warning' | 'info'; from: number; to: number; line: number; col: number;
  message: string; source: 'local' | 'catalog' | 'gateway'; fixes?: { label: string; apply: (doc) => ChangeSpec }[] }
```
Diagnostics render 3 ways from the same array (never diverge):
1. **Inline**: wavy underline on `from..to` (danger-600 / orange-700), tinted line background, gutter icon.
2. **Hover card** (`X01`): severity icon, title "Syntax error · line 5", mono code on the right, message, quick-fix buttons + Copy details.
3. **Problems tab** (`X04`): count badge, filter All/Errors/Warnings, row = icon, `Ln N`, message, fix button; click moves cursor and focuses editor. "Fix all" applies all fixes as **one** undoable transaction.

## Three validation layers
| Layer | When | What | Codes |
|---|---|---|---|
| 1. Local (instant) | every change, debounce 300 ms, in a worker | tokenizer errors, unbalanced `()` `''` `""`, missing `;` between statements, unknown keyword typos (edit distance ≤ 2), statement splitting | `SQL-PARSE` (local), `SQL-MULTI-STMT` |
| 2. Catalog (fast) | debounce 300 ms after layer 1 clean | table/view/column existence vs cached `SHOW CATALOGS/DATABASES/TABLES` + `DESCRIBE` (refresh on connect, on `CREATE/DROP`, and every 5 min); suggestions by edit distance | `SQL-UNKNOWN-TABLE`, `SQL-UNKNOWN-COLUMN` |
| 3. Gateway (authoritative) | debounce 800 ms after typing stops, only if layers 1–2 have no errors in that statement, max 1 in flight per tab (cancel stale) | `EXPLAIN <statement>` through the SQL Gateway session. Parse the error: `SqlParseException` / `SqlValidatorException` / `ValidationException` messages contain `at line L, column C` (or `From line L, column C to line L2, column C2`). Map to range; unmatched → whole statement. | `SQL-PARSE`, `SQL-UNKNOWN-*`, `SQL-TYPE`, `SQL-WINDOW-GROUP` |
| Lint rules (local, AST-lite) | with layer 1 | regular `JOIN` without time bound and no `table.exec.state.ttl` SET; `GROUP BY` without window on unbounded source; `SELECT DISTINCT` on stream; window TVF aggregate missing `window_start`/`window_end` | `SQL-STATE-TTL`, `SQL-WINDOW-GROUP` (warnings) |

Notes:
- Line numbers from the gateway are relative to the submitted statement; add the statement's start offset.
- `EXPLAIN` must never run DDL/DML side effects: only send `EXPLAIN` for `SELECT`/`INSERT`; for DDL (`CREATE TABLE …`) do layer 1–2 only and validate on Run.
- Never block typing; validation runs in a worker and results are discarded if the doc version changed.
- Ignored warnings (`Ignore`) are stored per statement hash so they do not reappear.

## Run behaviour
- Run = statement at cursor (highlight it briefly); Run all = every statement in order, stop at first failure.
- Run/Explain buttons disabled while errors exist in the target statement; inline reason next to Run (`SQL-RUN-BLOCKED`), shortcut ⌘↵ shows the same tooltip and moves to first error.
- States on the result area: idle → submitting (skeleton) → streaming (row counter, elapsed, Stop) → finished / cancelled (`SQL-CANCELLED`) / failed (`SQL-RUNTIME` banner above results with first cause line and Open job) .
- Result view keeps the latest 10,000 rows (setting), info banner `SQL-TRUNCATED`. Changelog results show op column (+I, -U, +U, -D) and update rows in place.
- Gateway connection loss mid-stream (`SQL-GATEWAY-LOST`): dim results, status badge "Reconnecting", back-off; do not cancel the job; on reconnect offer "Fetch again".
- Session expiry (`SQL-SESSION-EXPIRED`): open a new session silently, replay `SET` statements and `USE` from the tab, show warning banner once.
- No gateway configured (`SQL-NO-GATEWAY`): full-page state with "Edit connection".

## Tests (must exist)
- Unit: each local rule with positive/negative fixtures; gateway error message → range mapping (10+ real Flink messages as fixtures across 1.17, 1.20, 2.x).
- Component: typing produces squiggle + Problems row; quick fix replaces text; Fix all is one undo.
- E2E (against docker Flink 2.x + gateway): X01–X07 scenarios each produce the exact message and placement.
