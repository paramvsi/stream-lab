# Roadmap (build order)

Each milestone has a kickoff prompt in `prompts/`. **Phases come from the original plan.** Phase 1 (site MVP) is M0–M5, building only the MVP items. Phase 2 (desktop MVP) is M6–M10, MVP items only. Phase 3 (v1) is a second pass through M1–M10 for the v1 items in `TRACEABILITY.md`. M11 runs at the end of each phase. Do not start a milestone before the previous one's gate passes.

| # | Milestone | Scope | Gate |
|---|---|---|---|
| M0 | Foundations | monorepo, tokens.css, packages/ui core (Button, Field, Banner, Toast, Dialog, Drawer, Tabs, Table, EmptyState, Skeleton), packages/errors with generated catalog + presenters, Storybook, CI | stories for all core components; catalog test green |
| M1 | Graph + canvas | packages/graph (model, 16 node schemas, validation, schema propagation), React Flow workspace (W09 states), palette, quick-add, connect rules, toolbar, menus, undo/redo, auto-layout, autosave | SIM-01…15, 20, 22, 23 |
| M2 | Node drawers | bottom drawer, generated forms, CEL editor, previews (W10*) | NODE-01…07 |
| M3 | Engine + run | worker engine, run pill, run panel tabs, data generator, upload, ref tables | SIM-16…19, 21, 24, DATA-01…04 |
| M4 | Explain + tour + export | T01–T06, E01–E06, SQL export, docker bundle, share links, deep link | EXPL-01…03, EXP-01…04 |
| M5 | Website shell + course | landing (animated), download, 404, course, chapters, glossary, challenges | LAND-*, LEARN-* |
| M6 | Desktop shell + connections | Tauri app, Rust `flink_request`, keychain, transports, wizard C01, form, test steps, cert trust, import/export, fleet | INST-*, CONN-*, FLEET-01 |
| M7 | Cluster + jobs | cluster pages, jobs list, job pages, operator panel, checkpoints, exceptions, history | FLEET-02, JOB-* |
| M8 | Actions | stop/savepoint/cancel/rescale, submit JAR | ACT-* |
| M9 | SQL editor | three-layer validation, results, sessions | SQL-* |
| M10 | Ops + global | logs, profiling, alerts, command palette, updater, settings, crash recovery | OPS-*, APP-* |
| M11 | Hardening | fault injection matrix, a11y sweep, performance budgets, signed release | TESTING.md gates |
