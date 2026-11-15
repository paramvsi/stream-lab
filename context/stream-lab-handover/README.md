# Stream Lab: handover for Claude Code

Unzip this at the root of a new repo, then open Claude Code there. Claude Code reads `CLAUDE.md` automatically.

1. Run `prompts/M0-foundations.md` first, then go in order (`docs/ROADMAP.md`).
2. The designs are in `design/web` and `design/desktop`. Each `.dc.html` file is one board; open it in a browser. The live canvases (with comments and motion) are linked in `docs/SCREENS.md`.
3. `docs/COVERAGE.md` is the end-to-end audit. `docs/ERROR_CATALOG.md` lists every error case (135). `docs/TRACEABILITY.md` maps all 77 original features with their MVP/v1/Later priority.

| File | What it is |
|---|---|
| CLAUDE.md | rules, stack, definition of done |
| docs/PRODUCT.md | what and why |
| docs/FEATURES.md | features + acceptance criteria IDs |
| docs/TRACEABILITY.md | original 77 features → criteria → boards, with priority |
| docs/SCREENS.md | every board, route/component, file |
| docs/ERRORS_AND_ALERTS.md | severity, placement, message rules, implementation contract |
| docs/ERROR_CATALOG.md | every error/warning/notice |
| docs/SQL_EDITOR.md | SQL validation in detail |
| docs/SIMULATOR.md | React Flow canvas, undo/redo, run states, tour, explain |
| docs/NODES.md | 16 node types, config, ports, validation |
| docs/FLINK_API.md | how the desktop app reaches any cluster; endpoints |
| docs/ARCHITECTURE.md | repo, data flow, engine semantics, security |
| docs/DESIGN_SYSTEM.md, docs/MOTION.md | look and motion |
| docs/TESTING.md, docs/ROADMAP.md | quality gates, build order |
| seed/ | tokens.json, tokens.css, error-catalog.ts, node-icons.json, logo-mark.svg |
| prompts/ | one kickoff prompt per milestone |
