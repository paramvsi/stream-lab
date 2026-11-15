# M10 · Ops and global (Phase 2)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then docs/ERRORS_AND_ALERTS.md §5, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build the log viewer (MVP), command palette, shortcuts, updater, settings and crash recovery. Thread dumps and local alerts are v1. Flame graph/profiler viewer and webhooks are Later: do not build them.

## Build now (MVP)
- **OPS-01** Logs: JM/TM, follow, filter, regex (`LOG-REGEX`), large-file handling (`LOG-TOO-LARGE`).
- **APP-01** Command palette (⌘K) covering every navigation and action, with a shortcuts sheet.
- **APP-02** Auto-update: banner, dialog, progress, failure (`UPDATE-FAILED`).
- **APP-03** Crash recovery restores tabs (`APP-CRASH-RECOVERED`).
- **APP-04** Settings: appearance (light only in v1), polling, notifications, data and privacy (no telemetry by default), about.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **OPS-02** Thread dump, and flame graph (`PROFILER-OFF` when disabled).
- **OPS-03** Alert rules: create/edit/delete, validated (`ALERT-RULE-INVALID`); fire once and re-arm; mute; OS notifications (`ALERT-NOTIFY-DENIED`).

## Later: do not build
- **OPS-04** (Later) Flame graph and profiler results shown in the app with search (D19b is designed).
- **OPS-05** (Later) Webhook alerts (Slack or any URL).

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `D18-Logs`: D18 Logs · following
- `D18b-Logs-filtered`: D18 Logs · search and level filter
- `D19-ThreadDump`: D19 Thread dump (v1)
- `D19b-FlameGraph`: D19 Flame graph viewer (later)
- `D20-Alerts-recent`: D20 Alerts (v1) · recent
- `D20b-Alerts-rules`: D20 Alerts (v1) · rules
- `D20c-Alerts-new-rule`: D20 Alerts (v1) · new rule
- `D20d-Notification`: D20 Desktop notification
- `D21-Settings-0`: D21 Settings · general
- `D21-Settings-1`: D21 Settings · history and storage
- `D21-Settings-2`: D21 Settings · updates
- `D21-Settings-3`: D21 Settings · about
- `G01-Command-palette`: G01 Command palette
- `G02-Shortcuts`: G02 Keyboard shortcuts
- `G03-Update-banner`: G03 Update available · banner
- `G04-Update-dialog`: G04 Update available · dialog
- `G05-Updating`: G05 Updating
- `X13-Crash-recovery`: X13 Restarted after a crash
- `X15-Update-failed`: X15 Update failed
- `DM03-conn`: Motion · Connection test checklist
- `DM05-ui`: Motion · Panels, toasts and button states

## Error codes this milestone must raise and test (9)
Full rows are in `docs/ERROR_CATALOG.md`.
- `LOG-TOO-LARGE` (info, banner): This log is {size}. Showing the last 5,000 lines.
- `LOG-REGEX` (error, field): That pattern is not valid: {reason}.
- `PROFILER-OFF` (info, full-page state in tab): Flame graphs are off on this cluster. Set rest.flamegraph.enabled: true.
- `ALERT-RULE-INVALID` (error, field): {field}: {reason}.
- `ALERT-NOTIFY-DENIED` (warning, banner (alerts page)): Notifications are blocked for Stream Lab, so alerts only show inside the app.
- `ALERT-FIRED` (warning|error (rule severity), OS notification + alerts list + object badge): {rule}: {metric} is {value} on {job}.
- `UPDATE-FAILED` (error, banner (settings)): Update to {v} failed: {reason}. Nothing was installed.
- `APP-CRASH-RECOVERED` (warning, dialog): Stream Lab closed unexpectedly. Your connections and tabs were restored.
- `APP-UNSAVED` (warning, dialog): Close without saving {thing}?

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
