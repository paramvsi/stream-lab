# Stream Lab: rules for Claude Code

Read this file first in every session. Then read the doc for the area you are touching (see "Where things are").

## What we are building

Stream Lab has two products in one monorepo. They share one UI kit and one design system.

1. **Website** (`apps/web`): a static site with no backend. It holds:
   - a hands-on course about stream processing with Apache Flink;
   - a pipeline **simulator** that runs fully in the browser (a Web Worker), on a fintech scenario: payments, cards, merchants and refunds;
   - "Explain this run", a guided replay of what happened to each event.
2. **Desktop app** (`apps/desktop`): Tauri 2 with the same React code. It connects to real Flink clusters through the REST API (:8081) and the SQL Gateway (:8083). It does monitoring, job actions, a SQL editor, logs and alerts, in the style of DBeaver for Postgres.

Non-negotiables:

- **Frontend only.** No server of ours. The website deploys as static files. The desktop app talks to clusters directly from Rust/Tauri HTTP, which avoids CORS.
- **Never use the word "Flink" in the product name, logo or domain.** It is an Apache trademark. "for Apache Flink®" is fine in descriptive text.
- **No telecom, campaign or employer-specific examples.** Every sample is fintech: payments, cards, merchants, refunds, AED/USD/EUR.
- **Look:** Flink Rose on white. No blue or gray UI chrome; neutrals are the warm `ink`, `muted` and `line` tokens. The background grid with rose nodes is the only pattern, and it stays subtle.

## Stack (do not change without asking)

| Concern | Choice |
|---|---|
| Language | TypeScript strict, `noUncheckedIndexedAccess` |
| UI | React 19, Vite, Tailwind v4 using `seed/tokens.css` variables, Radix primitives for dialog, popover, menu and tooltip |
| Canvas | `@xyflow/react` v12 (see `docs/SIMULATOR.md`) |
| Layout | `elkjs` for auto-layout |
| State | Zustand plus `zundo` for undo/redo of the graph store |
| Forms | `react-hook-form` + `zod` (the schemas double as validation) |
| Server data (desktop) | TanStack Query, with polling set per query |
| Expressions | `cel-js` (CEL) for Filter, Validate, Route and Map |
| SQL node (v1) | DuckDB-WASM, lazy-loaded |
| Desktop storage | SQLite (`tauri-plugin-sql`) |
| Editors | CodeMirror 6, with `@codemirror/lang-sql` and lint |
| Charts | uPlot |
| Icons | `lucide-react` for UI chrome; the custom node icons in `seed/node-icons.json` for nodes only |
| Motion | CSS keyframes from `seed/tokens.css`; Motion (framer) only for layout transitions |
| Storage (web) | IndexedDB via `idb`; OPFS for uploaded files |
| Desktop | Tauri 2 plugins: http, store, stronghold or keyring, updater, notification, shell (deep link), dialog, fs |
| Tests | Vitest, Testing Library, Playwright (web and Tauri via WebDriver), axe-core |

## Repo layout

```
apps/web            static site: routes /, /learn, /sim/:id, /glossary, /download, /s#...
apps/desktop        Tauri shell + React routes (desktop-only screens)
packages/ui         design-system components (Button, Field, Banner, Toast, Dialog, Drawer, Table...)
packages/errors     AppError, catalog.ts (generated), presenters (FieldError, Banner, Toast...)
packages/engine     simulator engine (runs in a Worker): event time, watermarks, windows, state
packages/graph      pipeline model, zod schemas per node, graph validation, SQL export
packages/flink      typed REST + SQL Gateway client, zod response schemas, error mapping
packages/sql        SQL tokenizer, statement splitter, local lint rules, diagnostics model
packages/course     chapter content (MDX) + challenge checkers
```

## How to work

1. **Find the design first.** Every screen and state has an artboard; see `docs/SCREENS.md`. Open the HTML in `design/web` or `design/desktop`. Build the board as a *state of a component*, not a separate page.
2. **Check the priority** in `docs/TRACEABILITY.md`. Build MVP before v1, and never build Later items unasked.
3. **Find the feature's acceptance criteria** in `docs/FEATURES.md` (IDs like `SIM-07`). A PR is done when every criterion it touches passes and has a test.
4. **Every error goes through the catalog.** If you need an error that is not in `docs/ERROR_CATALOG.md`, add a row there and in `packages/errors/src/catalog.ts` in the same PR. Never `alert()`, never `console.error` as user feedback, never show raw exception text as the main message.
5. **Small PRs**, one milestone task each (`docs/ROADMAP.md`). Use conventional commits.
6. **Before you say "done"**, run `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`. Check the screen against its board at 1440×900 and at 1280×800.

## Definition of done (every PR)

- [ ] It matches the artboard: spacing, type, colours, and every state on the board (empty, loading, error, success).
- [ ] Every new user-visible error uses a catalog code, and a test triggers it.
- [ ] Keyboard: you can reach and use it without a mouse. Focus is visible (2px rose-600 ring). Escape closes overlays. Focus returns to the trigger.
- [ ] Screen readers: dialogs and drawers have a name; live regions announce toasts and banners. Contrast is AA (tokens already pass; never put white text on rose-500).
- [ ] Motion: it uses the tokens and is turned off under `prefers-reduced-motion`.
- [ ] The user never loses work: forms and editors keep their content on error; the graph autosaves.
- [ ] No new dependencies outside the stack table without saying why in the PR.

## Never do

- Call the Flink REST API from the website. The website never talks to clusters; "Send to desktop" uses the `streamlab://` deep link.
- Store secrets in localStorage, the Tauri store or logs. Secrets go in the OS keychain only.
- Run a destructive job action (cancel, stop, rescale) without the confirmation dialog on its board. Prod connections need type-to-confirm.
- Swallow errors (`catch {}`), or retry non-idempotent requests (POST stop/savepoint/run) automatically.
- Put colour alone on a state. Every status also has an icon and words.
- Invent Flink behaviour. If unsure, check the Flink docs for the connected version and leave a `// FLINK:` comment linking the source.

## Where things are

| Need | Read |
|---|---|
| What and why | `docs/PRODUCT.md` |
| Features + acceptance criteria | `docs/FEATURES.md` |
| Priority of every feature (MVP/v1/Later) | `docs/TRACEABILITY.md` |
| Every screen/state | `docs/SCREENS.md` + `design/` |
| Error/alert system rules | `docs/ERRORS_AND_ALERTS.md` |
| Every error case | `docs/ERROR_CATALOG.md` + `seed/error-catalog.ts` |
| SQL editor validation | `docs/SQL_EDITOR.md` |
| Simulator canvas (React Flow) | `docs/SIMULATOR.md` |
| Node types, config, validation | `docs/NODES.md` |
| Flink endpoints used | `docs/FLINK_API.md` |
| Tokens, components | `docs/DESIGN_SYSTEM.md`, `seed/tokens.json`, `seed/tokens.css` |
| Motion | `docs/MOTION.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Tests | `docs/TESTING.md` |
| Milestones | `docs/ROADMAP.md`, prompts in `prompts/` |
