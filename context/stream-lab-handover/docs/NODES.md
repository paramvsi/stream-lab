# Node types

Icons: `seed/node-icons.json` (24×24 stroke paths, stroke 1.75, round caps). Category colours: `seed/tokens.json → node-category`. Board `B03` shows tiles, states and handles; `W10-*` shows each config drawer.

Node visual: 184×64, white, 1 px `line` border, 4 px left bar in category accent, icon tile (category tint bg + accent icon), title + subtitle (config summary, mono). States: idle · hover · selected (rose-600 2 px ring) · running (`sl-glow`) · error (danger ring + "!" badge, count) · disabled (50% opacity, dashed border) · highlighted/dimmed (explain).

Every node config is a **zod schema** in `packages/graph/nodes/<type>.ts`; the drawer form is generated from it with field components; the schema is also the validator for graph checks, import, and share links.

| Node | Category | Ports in → out | Key settings | Validation (codes) |
|---|---|---|---|---|
| Source | Sources | – → main | topic/stream name, schema (fields + types), event-time field, watermark strategy (bounded out-of-orderness ms), idle timeout | `NODE-REQUIRED`, `WIN-NO-TIME` (downstream), `WM-LATENESS-BIG` |
| Generator | Sources | – → main | rate/s, duration or count, keys, late %, out-of-order %, duplicate %, bad rows %, seed | `GEN-INVALID` |
| Filter | Transform | main → main, rejected | CEL boolean expression | `CEL-PARSE`, `CEL-UNKNOWN-FIELD`, `CEL-TYPE` |
| Map | Transform | main → main | list of `field = CEL expr`, drop fields | `CEL-*`, duplicate output field |
| Lookup | Enrich | main → main, rejected (miss) | reference table, key mapping, as-of time (versioned), on miss: drop/pass/reject | `LOOKUP-NO-TABLE`, `LOOKUP-KEY-TYPE` |
| Join | Enrich | left, right → main | type (inner/left), keys, interval bound (lower/upper) | `JOIN-NO-BOUND` (warn), key type mismatch |
| Window | Time & state | main → main, late | tumble/hop/session/cumulate, size, slide/gap, key by, aggregates (count/sum/avg/min/max), allowed lateness, emit | `WIN-SIZE`, `WIN-NO-TIME` |
| Top-N | Time & state | main → main | partition by, order by, N, within window | N ≥ 1 |
| Pattern (v1) | Time & state | main → main | steps (name, CEL condition, times min..max), within duration, contiguity | `PATTERN-INVALID` |
| Validate | Quality | main → main, rejected | list of CEL rules with names and severity | `CEL-*` |
| Deduplicate | Quality | main → main | key, keep first/last, TTL | `DEDUP-NO-TTL` (warn) |
| Dead-letter | Quality | main → – | reason field, retention | – |
| Union | Transform | main × N → main | inputs (2+), add source tag field (optional) | `SIM-UNION-SCHEMA` |
| Route | Outputs | main → branch × N | ordered CEL conditions, default branch | `ROUTE-OVERLAP` (warn), `CEL-*` |
| Sink | Outputs | main → – | name, format (table/json), key | `NODE-REQUIRED` |
| SQL (v1) | Transform | main → main | SQL over `input`, run by DuckDB-WASM (lazy-loaded) | `SQLNODE-UNSUPPORTED` (DuckDB syntax that has no Flink equivalent is flagged on export) |

Graph-level checks (run on every change, debounced 150 ms, in a worker if > 50 nodes): `SIM-NO-SOURCE`, `SIM-NO-SINK`, `SIM-DISCONNECTED`, `SIM-SCHEMA-DRIFT`. Schemas propagate from sources along edges; each node declares `outputSchema(inputSchemas, config)`.

Drawer (bottom sheet) tabs: **Settings** (form + live preview of 5 sample events through this node) · **Input schema** · **Output preview** (incl. state per key for stateful nodes) · **Docs** (concept + link to chapter). Header: category-coloured top border, icon, name (editable), "Run to here", expand, close. Esc closes; focus returns to node.
