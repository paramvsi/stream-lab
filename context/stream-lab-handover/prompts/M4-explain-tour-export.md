# M4 · Explain, tour, export (Phase 1)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then docs/SIMULATOR.md (tour, explain), `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build the guided tour (T01–T06), Explain this run, Trace, the time scrubber and the stage inspector. Also the Flink SQL export, the share link (URL hash) and import/export JSON. The docker bundle, send-to-desktop and what-if/tests are v1.

## Build now (MVP)
- **EXPL-01** The tour starts automatically on the first visit to the simulator (it can be skipped) and later from the header. It has 5 action-based steps with a spotlight, and is completed once.
- **EXPL-02** Explain this run: pick an output row or a random event. Step through its path with the dim/highlight, step badges and a narration that uses real values. Keys ←/→, Esc to exit.
- **EXPL-03** Trace: select any output row and the canvas highlights the contributing inputs and nodes.
- **EXPL-05** Time scrubber: event-time axis with the watermark line and window boundaries. Dragging it moves the replay.
- **EXPL-06** Stage inspector: in, out, dropped and late counts per node, and state contents per key.
- **EXP-01** Flink SQL export covers sources, filters, maps, windows (TVF), joins (interval), lookups (FOR SYSTEM_TIME AS OF), dedup (ROW_NUMBER), top-N, pattern (MATCH_RECOGNIZE) and sinks. Unsupported nodes get a TODO comment (`EXPORT-UNSUPPORTED`).
- **EXP-04** Share link: the pipeline is compressed into the URL hash, with no server. A warning appears over 8,000 characters (`SHARE-TOO-LONG`). Opening the link gives a read-only copy with "Make a copy", and a broken link shows `SHARE-BROKEN`.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **EXPL-04** (v1) What-if compare (change a setting, rerun, diff the output) and expected outputs as tests (pin a result, pass/fail on later edits). E07–E09.
- **EXP-02** The docker-compose bundle runs the exported SQL on a local Flink + Kafka, with a README.
- **EXP-03** Send to desktop: the `streamlab://import?…` deep link opens the app; a timeout shows the fallback (`DESKTOP-NOT-FOUND`).

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `T01-Tour-palette`: T01 Tour · step 1 of 5, your node library
- `T02-Tour-canvas`: T02 Tour · step 2 of 5, drop a source
- `T03-Tour-drawer`: T03 Tour · step 3 of 5, configure from below
- `T04-Tour-run`: T04 Tour · step 4 of 5, run, step or break it
- `T05-Tour-timeline`: T05 Tour · step 5 of 5, watch the watermark
- `T06-Tour-done`: T06 Tour · finished
- `E01-Explain-1`: E01 Explain this run · an event arrives
- `E02-Explain-2`: E02 Explain this run · it passes the rules
- `E03-Explain-3`: E03 Explain this run · the window fires
- `E04-Explain-4`: E04 Explain this run · a late event is set aside
- `E05-Explain-5`: E05 Explain this run · routed as an alert
- `E06-Trace`: E06 Trace · one output row highlighted on the canvas
- `E07-Compare`: E07 What-if compare (v1)
- `E08-Tests-pass`: E08 Tests · passing (v1)
- `E09-Tests-fail`: E09 Tests · failing (v1)
- `W17-Export-sql`: W17 Export · Flink SQL
- `W17b-Export-compose`: W17 Export · Run it for real (v1)
- `W17c-Export-desktop`: W17 Export · send to desktop (v1)
- `W17d-Export-desktop-wait`: W17 Export · opening the desktop app
- `W17e-Export-desktop-none`: W17 Export · desktop app not found
- `W17f-Export-desktop-sent`: W17 Export · sent to desktop
- `W18-Shared-readonly`: W18 Shared link · read-only copy
- `W18b-Share-dialog`: W18 Share dialog
- `WX05-Link-too-long`: WX05 Share link too long
- `WM07-tour`: Motion · tour spotlight

## Error codes this milestone must raise and test (4)
Full rows are in `docs/ERROR_CATALOG.md`.
- `SHARE-TOO-LONG` (warning, field (share dialog)): This link is {n} characters; some apps cut long links.
- `SHARE-BROKEN` (error, full-page state): This link is damaged or incomplete.
- `EXPORT-UNSUPPORTED` (warning, banner in export dialog): {node} has no direct Flink SQL; it is exported as a comment with a TODO.
- `DESKTOP-NOT-FOUND` (info, dialog): Stream Lab desktop did not open. Install it, or copy the SQL.

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
