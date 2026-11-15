# M11 · Hardening (end of every phase)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/TESTING.md`, `docs/COVERAGE.md`.

## Task
For the phase just finished, run the full gate: the fault-injection matrix (toxiproxy), the axe sweep, visual baselines, performance budgets, fidelity tests (from Phase 3) and the signed release pipeline. Fix everything that fails, and report what is still open.

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
