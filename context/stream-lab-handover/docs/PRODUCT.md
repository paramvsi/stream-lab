# Product

## One line
Learn real-time stream processing by building and breaking pipelines in your browser, then run and manage the real thing on your Flink clusters with a modern desktop app.

## Who it is for
- **Learners** (backend/data engineers new to streaming): course + simulator, no install, no cluster.
- **Practitioners** running Flink: the desktop app as a daily driver beside (not replacing) the Flink Web UI.
- **Hiring managers / reviewers** looking at Paramveer's portfolio: the landing and simulator must feel like a product, not a demo.

## The two products

### Website (static, free hosting)
| Area | What it does |
|---|---|
| Landing | Animated hero pipeline, features, "Explain this run" preview, desktop download section. |
| Course | 10 chapters (see LEARN-05): 1–6 are MVP, 7–10 are v1. Each chapter is a reading, a sandbox and a challenge. |
| Simulator | React Flow canvas, 15 node types in 6 categories, bottom drawer to configure a node, run/pause/step/speed/chaos, live counts on edges, problems panel, undo/redo, auto-layout. |
| Data | Seeded generator (rate, keys, late %, out-of-order %, duplicates %, bad rows %), CSV/JSONL upload, reference tables (versioned) for lookups. |
| Explain | Guided tour of the UI (5 steps) and "Explain this run": step-by-step narration of one event's path with spotlight + dimming; trace any output row back to its inputs. |
| Export & share | Flink SQL export, docker-compose "run it for real", send to desktop (deep link), share link (URL hash), JSON import/export. |
| Glossary | Concept cards that open as drawers from anywhere. |

### Desktop app (Tauri)
| Area | What it does |
|---|---|
| Connections | Form with validation and Test; auth: none, basic, bearer, mTLS; SSH tunnel; Kubernetes port-forward; import/export; tags (prod/staging/dev); read-only flag. |
| Fleet | All connections at a glance; health, jobs running/failed, slots. |
| Cluster | Overview, TaskManagers (+ detail, thread dump, flame graph), Applications (Flink 2.3+). |
| Jobs | List with filters; job page: graph with backpressure/watermarks, operator metrics, subtasks, history, exceptions, checkpoints, config compare, savepoints. |
| Actions | Stop with savepoint, trigger savepoint, cancel (prod type-to-confirm), rescale, submit JAR wizard, restart from savepoint. |
| SQL | SQL Gateway editor with live validation (see SQL_EDITOR.md), results grid, plan, streaming results. |
| Logs | JM/TM logs with filter, regex, follow. |
| Alerts | Local rules (job failed, restarts, checkpoint failures, backpressure, watermark stall, lag), OS notifications. |
| Global | Command palette, shortcuts, auto-update, settings. |

## Release plan (from the original list)
Phase 1 is the site MVP (about 6 weeks), Phase 2 the desktop MVP (about 5 weeks), Phase 3 is v1 (about 8 weeks), then Later. Priorities per feature are in `TRACEABILITY.md`.

## Out of scope (v1)
Accounts and hosted backends; managing Kubernetes resources (FlinkDeployment objects); multi-user permissions; writing or compiling Java/Scala DataStream code; running real Flink in the browser (the simulator models Flink and says so).

## Success measures
- Website: a new visitor reaches "first successful run" in under 2 minutes; 40% finish tour step 5.
- Desktop: connect to a cluster in under 60 s from install; zero destructive action without confirmation.

## Open questions (from the original list, still open)
- Final domain; GitHub owner for the repo and releases.
- Check the employment contract's intellectual-property clause for side projects **before publishing**.
- How long to keep local history, and its size limit (default proposed: 30 days, 2 GB).
- Dark theme: the original list wants dark and light. The designs are light only. Build tokens so dark can be added; ship light first.
