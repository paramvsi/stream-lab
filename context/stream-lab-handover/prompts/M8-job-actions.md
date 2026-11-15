# M8 · Job actions (Phase 2)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then docs/FLINK_API.md (actions), docs/ERRORS_AND_ALERTS.md §4, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build stop with savepoint (the default), trigger savepoint, cancel behind it with prod type-to-confirm, and read-only mode. Rescale and the submit wizard with saved run configurations are v1. Never auto-retry a POST; after a timeout, query the state first.

## Build now (MVP)
- **ACT-01** Stop with savepoint: folder prefilled from the config or required (`SP-DIR-MISSING`), a drain option, a progress state, success and failure (`SP-FAILED`, `SP-TIMEOUT`).
- **ACT-02** Trigger a savepoint without stopping. Cancel needs type-to-confirm on prod (`CANCEL-PROD`).
- **ACT-05** Conflicts are detected (`API-409`). None of these calls is retried automatically.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **ACT-03** Rescale: slot check (`RESCALE-SLOTS`), and a fallback when the scheduler is not adaptive (`RESCALE-UNSUPPORTED`).
- **ACT-04** Submit JAR wizard: upload, configure, run, then ok or error, with all `SUBMIT-*` codes. Restore from savepoint, with "allow non-restored state".
- **ACT-06** (v1) Saved run configurations for submit, which check that the savepoint still exists (`SUBMIT-SP-MISSING`, X17).

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `D15-Stop-savepoint`: D15 Stop with savepoint · confirm
- `D15b-Stop-progress`: D15 Stop with savepoint · in progress
- `D15c-Stop-success`: D15 Stop with savepoint · done
- `D15d-Stop-failed`: D15 Stop with savepoint · failed
- `D15e-Cancel-prod`: D15 Cancel on production · type to confirm
- `D15f-Trigger-savepoint`: D15 Trigger savepoint · in progress toast
- `D15g-Rescale`: D15 Rescale (v1)
- `D16-Submit-upload`: D16 Submit JAR (v1) · choose JAR
- `D16-Submit-config`: D16 Submit JAR (v1) · configure
- `D16-Submit-run`: D16 Submit JAR (v1) · submitting
- `D16-Submit-ok`: D16 Submit JAR (v1) · running
- `D16-Submit-err`: D16 Submit JAR (v1) · failed to start
- `X09-Permission-denied`: X09 Action not allowed (403)
- `X10-Conflict`: X10 Conflict (409): job already stopping
- `X14-Savepoint-dir-missing`: X14 Stop dialog: savepoint folder not configured
- `X17-Submit-saved-configs`: X17 Submit · saved run configurations
- `DM04-dialog`: Motion · Dialog open and close

## Error codes this milestone must raise and test (16)
Full rows are in `docs/ERROR_CATALOG.md`.
- `SUBMIT-SP-MISSING` (error, banner): This configuration restores from {sp}, which was deleted.
- `API-403` (error, toast): {action} was refused: your access does not allow it (403).
- `API-409` (warning, dialog): {job} is already {state}. Stream Lab will follow that operation.
- `API-5XX` (error, toast): {conn} had an internal error while {verb}.
- `SP-DIR-MISSING` (error, field (dialog)): This cluster has no default savepoint folder. Enter one the JobManager can write to.
- `SP-FAILED` (error, dialog (result step)): Savepoint failed: {reason}. The job is still running.
- `SP-TIMEOUT` (warning, dialog): The savepoint is taking longer than usual ({dur}). You can keep waiting or close this; it continues on the cluster.
- `CANCEL-PROD` (warning, dialog (type-to-confirm)): Cancel {job} on production without a savepoint? Its state will be lost.
- `RESCALE-UNSUPPORTED` (info, dialog): Rescaling in place needs the adaptive scheduler. You can stop with a savepoint and resubmit with a new parallelism.
- `RESCALE-SLOTS` (error, field): Needs {need} slots; only {free} are free.
- `SUBMIT-NOT-JAR` (error, field (drop zone)): {file} is not a JAR file.
- `SUBMIT-TOO-LARGE` (error, field): {file} is {size}; this cluster accepts up to {max}.
- `SUBMIT-NO-MAIN` (error, field): No main class found. Enter the entry class.
- `SUBMIT-ARGS` (error, field): Unclosed quote in arguments at character {pos}.
- `SUBMIT-SP-INCOMPAT` (error, panel (result)): The savepoint has state for operators that no longer exist. Turn on "Allow non-restored state" only if you mean to drop it.
- `SUBMIT-PROGRAM` (error, panel (result)): The job failed to start: {first line}.

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
