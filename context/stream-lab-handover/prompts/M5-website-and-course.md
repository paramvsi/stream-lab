# M5 · Website and course (Phase 1)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/MOTION.md`, `docs/PRODUCT.md`, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Build the landing (animated hero, pauses off-screen, still frame under reduced motion), download page with OS detection, 404, course index, chapter layout (reading + embedded sandbox + challenge), glossary and concept drawer, and challenge checkers. Write the content for chapters 1–6. Draft each chapter outline first and show it to Paramveer before writing the full text.

## Build now (MVP)
- **LAND-01** The hero pipeline animates on load: events flow, the window fires, output rows appear. It shows a still frame under reduced motion.
- **LAND-02** The primary CTA "Start building" opens the scenario gallery; the secondary CTA "Take the course" opens /learn.
- **LAND-03** The download section detects the OS and highlights the right installer (W02 mac/win/linux). The other installers are listed under it.
- **LAND-04** Sections animate in on scroll with the stagger tokens, once each, not on every scroll.
- **LAND-05** An unknown route shows the 404 page (W03) with links to the course and the simulator.
- **LAND-06** Lighthouse scores: performance ≥ 90, accessibility = 100, on mobile and desktop.
- **LEARN-01** There are 10 chapters. Progress is saved in IndexedDB. The course page shows new, in-progress and done states.
- **LEARN-02** A chapter has reading, a sandbox (an embedded mini simulator) and a challenge.
- **LEARN-03** A challenge checker returns pass/fail and a hint (`COURSE-WRONG`). Passing marks the chapter done and shows a dialog.
- **LEARN-05** Chapters, in this order: 1 Event time vs processing time · 2 Watermarks and late events · 3 Windows · 4 Aggregations and Top-N · 5 Deduplication · 6 Joins and versioned lookups (MVP); 7 State and TTL · 8 Pattern detection (MATCH_RECOGNIZE) · 9 Changelogs and retractions (FROM_CHANGELOG / TO_CHANGELOG, Flink 2.3) · 10 Checkpoints, exactly-once and backpressure (v1).
- **LEARN-04** Concept links open a glossary drawer, and you can open it without leaving the chapter. Glossary search covers names and aliases, and has an empty state.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- (none)

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `W02-Download-mac`: W02 Download · macOS detected
- `W02b-Download-win`: W02 Download · Windows detected
- `W02c-Download-linux`: W02 Download · Linux detected
- `W03-NotFound`: W03 404 · not found
- `W01-Landing`: W01 Landing · animated hero
- `W01b-Landing-Returning`: W01 Landing · returning visitor
- `W04-Course-new`: W04 Course · new learner
- `W04b-Course-progress`: W04 Course · in progress
- `W04c-Course-done`: W04 Course · completed
- `W05-Chapter-read`: W05 Chapter · reading, sandbox idle
- `W05b-Chapter-run`: W05 Chapter · sandbox running
- `W05c-Chapter-challenge`: W05 Chapter · challenge
- `W05d-Chapter-wrong`: W05 Chapter · wrong answer with hint
- `W05e-Chapter-pass`: W05 Chapter · challenge passed
- `W05f-Chapter-complete`: W05 Chapter · chapter complete dialog
- `W06d-Concept-drawer`: W06 Concept card · drawer over a chapter
- `W06-Glossary`: W06 Glossary · index
- `W06b-Glossary-search`: W06 Glossary · search results
- `W06c-Glossary-empty`: W06 Glossary · no results
- `WX07-Unsupported-browser`: WX07 Unsupported browser

## Error codes this milestone must raise and test (2)
Full rows are in `docs/ERROR_CATALOG.md`.
- `BROWSER-UNSUPPORTED` (error, full-page state): This browser can not run the simulator. You can still read every chapter.
- `COURSE-WRONG` (warning, inline under the challenge): Not yet: {hint}.

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
- Lighthouse: performance ≥ 90 and accessibility 100 (LAND-06).
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
