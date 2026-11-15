# M0 · Foundations (Phase 1)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/DESIGN_SYSTEM.md`, `docs/ERRORS_AND_ALERTS.md`, `docs/MOTION.md`, `docs/ARCHITECTURE.md`.

## Task
Set up the pnpm + turborepo monorepo exactly as in docs/ARCHITECTURE.md (apps/web, apps/desktop placeholder, all packages). Copy seed/tokens.css into packages/ui and seed/error-catalog.ts into packages/errors/src/catalog.ts. Build every component listed in docs/DESIGN_SYSTEM.md with all of its states, plus AppError, present(), fromHttp/fromTauriHttp/fromFlinkErrors and the presenters (FieldError, Banner, Toast, ProblemsPanel, Dialog, EmptyState). Storybook with a story per state. CI runs lint, typecheck, unit, catalog and a11y. Also add docker/ with Flink 1.20, 2.0, 2.2 and 2.3 session clusters + SQL Gateway + Kafka; later milestones need it.

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `B01-Logo-options`: B01 Logo · six concepts
- `B02-Logo-system`: B02 Logo · chosen mark and usage
- `WX00-Alert-system`: WX00 Errors and alerts · system
- `WM00-Tokens`: Motion · principles and tokens
- `WM04-ui`: Motion · Panels, toasts and button states
- `WM05-dialog`: Motion · Dialog open and close
- `X00-Alert-system`: X00 Errors and alerts · system
- `DM00-Tokens`: Motion · principles and tokens

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
- Every catalog entry renders through present() with sample params (catalog test). Stories exist for X00/WX00 severities and placements.
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
