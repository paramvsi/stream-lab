# M7 · Cluster and jobs (Phase 2)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/FLINK_API.md`, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build the cluster pages, the jobs list (with saved views across clusters), the job pages, the operator panel, checkpoints, exceptions (grouped) and history, using the polling defaults and the stale/partial/timeout rules. Add local history in SQLite with retention, the version capability table, HA failover handling and the Explain-this hints linked to chapters.

## Build now (MVP)
- **FLEET-02** Cluster pages: overview KPIs and charts, TaskManagers list and detail, JobManager config, Applications (2.3+).
- **JOB-01** Jobs list: filter by state, search, sort, with empty and loading states.
- **JOB-02** Job overview: graph with per-operator backpressure and watermark badges, KPIs, and states for healthy, backpressure, restarting, finished, read-only and explain.
- **JOB-03** Operator panel: metrics charts, watermarks, subtasks with skew.
- **JOB-04** History, exceptions (root cause first, full trace copyable), checkpoints (failing state), savepoints list.
- **JOB-05** Status changes raise the right codes (`JOB-*`).
- **JOB-06** Local history (MVP): metrics, checkpoints, restarts and rescales stored in SQLite while the app is open, shown on a timeline. Retention and size limit are set in Settings (`HISTORY-FULL`).
- **JOB-08** Grouped exceptions (MVP): collapsed by type and message, with count and first/last seen; expand to each occurrence (X20).
- **JOB-10** Explain this (MVP): a plain-language hint on each warning signal, linked to the matching chapter.
- **JOB-11** Saved views and a cross-cluster job list (`FLEET-PARTIAL` when some connections do not answer) (X18).
- **JOB-12** Checkpoint dashboard (MVP): duration, size, alignment time and failures over time, with the slowest operator flagged.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **JOB-14** (v1) Config compare: a job's config against another job, cluster or earlier version (D13).
- **JOB-07** (v1) Watermark lag: each operator's watermark against wall-clock time, and which input holds it back.
- **JOB-09** (v1) Restart and rescale timeline, using `/jobs/:jid/rescales/overview` and `/history` on 2.3+.
- **JOB-13** (v1) Savepoint catalogue: savepoints seen or triggered per job; copy the path; restore.

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `D03e-Unreachable`: D03 Cluster unreachable · full page
- `D05-Cluster`: D05 Cluster overview
- `D05b-TaskManagers`: D05 Cluster · TaskManagers
- `D05c-TaskManager-detail`: D05 TaskManager detail drawer
- `D06-Applications`: D06 Applications (v1, Flink 2.3)
- `D07-Jobs`: D07 Job list
- `D07b-Jobs-filtered`: D07 Job list · filtered to failing
- `D07c-Jobs-empty`: D07 Job list · empty cluster
- `D07d-Jobs-loading`: D07 Job list · loading
- `D08-Job-healthy`: D08 Job overview · healthy
- `D08b-Job-backpressure`: D08 Job overview · backpressure with hint
- `D08c-Job-restarting`: D08 Job overview · failing and restarting
- `D08d-Job-finished`: D08 Job overview · finished
- `D08e-Job-readonly`: D08 Job overview · read-only connection
- `D08f-Job-explain`: D08 Job overview · explain drawer
- `D09-Operator-metrics`: D09 Operator panel · metrics
- `D09b-Operator-watermarks`: D09 Operator panel · watermark lag
- `D09c-Operator-subtasks`: D09 Operator panel · subtask skew
- `D10-Job-history`: D10 Job history · local timeline
- `D11-Job-exceptions`: D11 Exceptions · grouped
- `D11b-Job-exception-detail`: D11 Exceptions · expanded group
- `D12-Job-checkpoints`: D12 Checkpoints · healthy
- `D12b-Job-checkpoints-failing`: D12 Checkpoints · failing
- `D13-Job-config-compare`: D13 Configuration · compare with staging (v1)
- `D14-Job-savepoints`: D14 Savepoints (v1)
- `D14b-Job-savepoints-empty`: D14 Savepoints · none yet
- `C05-Version-capabilities`: C05 Version capabilities · what works on this cluster
- `C06-Leader-changed`: C06 JobManager failover (HA): leader moved
- `X11-Partial-data`: X11 Partial data: some TaskManagers did not answer
- `X12-Timeout-retry`: X12 Slow cluster: timeout with automatic retry
- `X18-Jobs-saved-views`: X18 Jobs · saved views across all clusters
- `X19-History-retention`: X19 Local history · storage limit reached
- `X20-Exceptions-grouped`: X20 Exceptions · grouped by type
- `DM01-metric`: Motion · Live metrics and loading
- `DM02-bp`: Motion · Backpressure on the job graph

## Error codes this milestone must raise and test (17)
Full rows are in `docs/ERROR_CATALOG.md`.
- `CONN-LOST` (warning, banner): Lost contact with {conn}. Retrying every {s} s; showing data from {ago}.
- `CONN-HA-FAILOVER` (warning, banner): The JobManager leader changed. Reconnected to {jm}. Jobs are recovering from checkpoint {id}.
- `CONN-FEATURE-VERSION` (info, banner + hidden action): Some features are hidden because this cluster runs Flink {version}.
- `HISTORY-FULL` (warning, banner (settings) + toast once): History is full. The oldest days are being removed.
- `FLEET-PARTIAL` (warning, banner): {n} connections did not answer ({names}). Their jobs are missing from this view.
- `API-404-JOB` (info, full-page state): This {thing} no longer exists on {conn}. It may have finished and been cleaned up.
- `API-TIMEOUT` (warning, banner): {conn} is slow to answer. Retrying in {s} s (attempt {n} of 5).
- `API-PARTIAL` (warning, banner + row badge): {n} of {total} TaskManagers did not answer. Their values are from {ago} and marked stale.
- `API-SHAPE` (error, inline in widget): Could not read this part of the response. Other panels still work.
- `API-RATE` (warning, banner): The cluster asked us to slow down. Refresh is now every {s} s.
- `JOB-FAILED` (error, object badge + banner on job page + OS notification if rule exists): {job} failed: {root cause first line}.
- `JOB-RESTARTING` (warning, object badge + banner): {job} restarted {n} times in {period}. Last cause: {cause}.
- `JOB-BACKPRESSURE` (warning, object badge on operator): {operator} is backpressured {pct}% of the time.
- `JOB-WM-STALL` (warning, object badge on operator): Watermark at {operator} has been stuck at {time} for {dur}. An idle partition is a common cause.
- `JOB-CKPT-FAIL` (warning, banner on checkpoints tab + badge): Checkpoint {id} failed after {dur}: {reason}.
- `JOB-CKPT-NONE` (info, inline note): Checkpointing is off for this job, so it cannot recover state after a failure.
- `JOB-READONLY` (info, banner): This connection is read-only. Actions are hidden.

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
- Performance: a 100-job list renders in under 1 s.
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
