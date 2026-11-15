# Milestone status

Generated from the test names (`grep` of IDs and codes across `*.test.ts*` and `apps/web/e2e/*.spec.ts`), then checked by running those files. All listed files pass at the commit that last touched this table.

How to run: `pnpm lint && pnpm typecheck`, `npx vitest run <files>`, `pnpm e2e` (Playwright, installed Chrome, port 5280).

## M0 · Foundations — gate met

| Gate (ROADMAP)                  | Evidence                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Stories for all core components | `packages/ui/src/*.stories.tsx`, `packages/errors/src/Errors.stories.tsx`; every story runs under axe in `stories.test.tsx` |
| Catalog test green              | `packages/errors/src/errors.test.ts`: every code renders through `present()` with sample params                             |

## M1 · Graph + canvas (Phase 1, MVP)

Gate (ROADMAP): SIM-01…15, 20, 22, 23.

| ID / code                                                                                                                                                 | Test files                                                                                      | Status                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| SIM-01 gallery                                                                                                                                            | `scenarios.test.ts`, `pipelines.spec.ts`                                                        | pass                                                                     |
| SIM-02 My pipelines, import                                                                                                                               | `storage.test.ts`, `graph.test.ts`, `pipelines.spec.ts`                                         | pass                                                                     |
| SIM-03 palette                                                                                                                                            | `workspace.spec.ts`                                                                             | pass                                                                     |
| SIM-04 quick-add                                                                                                                                          | `workspace.spec.ts`, `m1-audit.spec.ts`                                                         | pass                                                                     |
| SIM-05 helper lines                                                                                                                                       | `geometry.test.ts`, `canvas-tools.spec.ts`                                                      | pass                                                                     |
| SIM-06 / SIM-07 connect rules                                                                                                                             | `graph.test.ts`                                                                                 | pass                                                                     |
| SIM-08 / SIM-09 quick-add from handle, insert on edge                                                                                                     | `store.test.ts`, `m1-audit.spec.ts`                                                             | pass                                                                     |
| SIM-10 toolbar, menus                                                                                                                                     | `canvas-tools.spec.ts`, `m1-audit.spec.ts`                                                      | pass                                                                     |
| SIM-11 multi-select, copy/paste                                                                                                                           | `store.test.ts`                                                                                 | pass                                                                     |
| SIM-12 undo/redo, history                                                                                                                                 | `store.test.ts`, `workspace.spec.ts`, `m1-audit.spec.ts`                                        | pass                                                                     |
| SIM-13 auto-layout                                                                                                                                        | `geometry.test.ts`, `canvas-tools.spec.ts`, `m1-audit.spec.ts`                                  | pass                                                                     |
| SIM-14 graph validation                                                                                                                                   | `graph.test.ts`                                                                                 | pass                                                                     |
| SIM-15 run blocked                                                                                                                                        | `graph.test.ts`, `workspace.spec.ts`                                                            | pass                                                                     |
| SIM-20 autosave, unload, two tabs                                                                                                                         | `storage.test.ts`, `pipelines.spec.ts`                                                          | pass                                                                     |
| SIM-22 minimap/controls, `?` sheet                                                                                                                        | `modes.spec.ts`                                                                                 | pass                                                                     |
| SIM-23 large graph, small screen                                                                                                                          | `modes.spec.ts`                                                                                 | pass                                                                     |
| SIM-25 schema on every edge                                                                                                                               | `graph.test.ts` (propagation, inference, JSON Schema), `m1-audit.spec.ts` (shown on edge hover) | partial: **editing** the schema needs the drawer's Input schema tab (M2) |
| NODE-01 (part) open settings                                                                                                                              | `canvas-tools.spec.ts`                                                                          | rename + docs only; generated forms are M2                               |
| NODE-06 node types                                                                                                                                        | `graph.test.ts`                                                                                 | specs for all 16; drawer forms are M2                                    |
| SIM-NO-SOURCE, SIM-NO-SINK, SIM-DISCONNECTED, SIM-CYCLE, SIM-PORT-TYPE, SIM-SCHEMA-DRIFT, SIM-RUN-BLOCKED, SIM-UNION-SCHEMA, SIM-DUP-EDGE, SIM-PORT-TAKEN | `graph.test.ts` (+ e2e for NO-SOURCE)                                                           | pass                                                                     |
| SIM-DELETE-UNDO                                                                                                                                           | `store.test.ts`, `workspace.spec.ts`, `m1-audit.spec.ts`                                        | pass                                                                     |
| SIM-UNDO-EMPTY, SIM-REDO-EMPTY                                                                                                                            | `workspace.spec.ts`                                                                             | pass                                                                     |
| SIM-TAB-CONFLICT                                                                                                                                          | `storage.test.ts`, `pipelines.spec.ts`                                                          | pass                                                                     |
| SIM-SMALL-SCREEN, SIM-LARGE-GRAPH                                                                                                                         | `modes.spec.ts`                                                                                 | pass                                                                     |
| IMPORT-INVALID, PIPELINE-NOT-FOUND, STORE-FULL, STORE-BLOCKED                                                                                             | `graph.test.ts`, `pipelines.spec.ts`, `storage.test.ts`                                         | pass                                                                     |

### Not done in M1, and why

| Item                                              | Why                                                                                                                                               | Where it lands |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| SIM-16…19, 21, 24, SIM-SLOW, SIM-RUNTIME-EXPR     | Running a pipeline needs the engine. The M1 prompt lists them, but ROADMAP and the prompt's own "stub the run pill" put them in M3 (MORNING D15). | M3             |
| Run pill states (W09i–k), WM03/WM06 motion        | Same: engine.                                                                                                                                     | M3             |
| Board pixel-match at 1440×900 / 1280×800          | Checked by screenshots and e2e at both sizes; no approved visual baselines exist yet to diff against (TESTING.md "Visual" row).                   | M11            |
| Header Tour / Explain run / Data / Share / Export | M3–M4 features; omitted, not shown disabled.                                                                                                      | M3, M4         |

## M2 · Node drawers (MVP) — gate met

Gate (ROADMAP): NODE-01…07. The e2e files ran at 1440×900 and 1280×800.

| Criterion                                                                                              | Evidence                                                                                   | Status                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------- |
| NODE-01 drawer, four tabs, Enter/double-click opens                                                    | `drawer.spec.ts` (NODE-01, NODE-06), axe on the dialog                                     | pass                        |
| NODE-02 generated forms, inline errors, live badge                                                     | `drawer.spec.ts` (NODE-02 ×2), `checks.test.ts`, `drawer-audit.spec.ts` (audits 2, 3, 7+9) | pass                        |
| NODE-03 CEL highlighting, autocomplete, squiggle, quick fix                                            | `drawer.spec.ts` (NODE-03), `checks.test.ts` (CEL-*)                                       | pass                        |
| NODE-04 5 events before/after, state per key (the run engine on samples; also under the Settings form) | `preview.test.ts`, `drawer.spec.ts` (NODE-04 ×2)                                           | pass, with the limits below |
| NODE-05 Run to here (drawer, toolbar, menu)                                                            | `drawer.spec.ts` (NODE-05), `preview.test.ts`                                              | pass, with the limits below |
| NODE-06 all Phase 1 node types with their codes                                                        | `graph.test.ts`, `checks.test.ts`, `drawer.spec.ts` (NODE-06)                              | pass                        |
| NODE-07 one undo step per edit, resize, collapse, Esc → node                                           | `drawer.spec.ts` (NODE-07 ×2), `store.test.ts`, `drawer-audit.spec.ts` (audits 1, 4, 6)    | pass                        |

### Not done in M2, and why

| Item                                   | Why                                                    | Where it lands |
| -------------------------------------- | ------------------------------------------------------ | -------------- |
| Lookup preview: every event misses     | No reference tables until DATA (MORNING D33)           | M3             |
| Pattern and SQL node forms run nothing | v1 (NODE-08, Pattern)                                  | v1             |
| Board pixel-match for W10*             | No approved visual baselines yet (TESTING.md "Visual") | M11            |
