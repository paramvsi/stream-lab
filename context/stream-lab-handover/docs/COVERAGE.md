# End-to-end coverage audit (15 Nov 2026)

What was checked: every feature in `FEATURES.md` has (a) at least one artboard, (b) its error cases in the catalog, and (c) each catalog code points to a board that exists. The cross-check script is in the handover generator; it reports **0 missing boards and 0 unknown codes**.

Totals: Website canvas **108 boards**, Desktop canvas **120 boards**, **128 error codes**, **15+1 node types**. All **77 features from the original list** are mapped in `TRACEABILITY.md`.

## Second pass: checked against the original feature list
The first handover had drifted from the original list. Fixed:
- Priorities (MVP / v1 / Later) restored, and all 77 features mapped.
- Missing criteria added: schema inference on edges, DuckDB SQL node, fintech/e-commerce/PaySim packs, engine parallelism/changelog/checkpoint simulation, fidelity tests, time scrubber, stage inspector, local history, watermark lag, grouped exceptions, rescale timeline, Explain-this hints, saved views, checkpoint dashboard, savepoint catalogue, saved run configs, plan graph, saved queries, verify-TLS switch, webhooks/flame graph (Later).
- New boards: C08, X16–X20. The C05 version table is aligned to the supported range.
- Version range set to 1.20 and 2.x, as in the original plan (the first handover said 1.17).
- Rescale endpoint verified against the Flink docs: `PUT /jobs/:jid/resource-requirements`. The original list's `PATCH /rescaling` is disabled in Flink, so it was wrong there.
- The FlinkClient interface (SimulatorClient / HttpClient) and the performance targets are restored in ARCHITECTURE and TESTING.

## Pipeline building: coverage

| Area | Covered by | Edge cases handled |
|---|---|---|
| Start (gallery, blank, import) | W07, W07b, W08*, W09 | import invalid/newer version, empty list, loading |
| Add nodes | W09 (palette), W09b (quick-add), W09h (insert on edge), W09p (command palette) | search empty, keyboard-only add, drop connection on empty pane |
| Move and arrange | W09c (helper lines), W09o (auto-layout) | snap, multi-select, undo of layout |
| Connect | W09d (valid), W09e (invalid) | cycles, self-loop, duplicates, schema/port mismatch, Join left/right arity, Union schemas |
| Configure | W10 × 15 nodes, W10x/y/z, WX01 | required fields, CEL parse/field/type, window sizes, missing event time, lateness, lookup table/key, unbounded join, dedup TTL, pattern steps, route default, unsupported SQL |
| Validate graph | W09l, WX02 | no source, dangling outputs, disconnected node, schema drift after an upstream edit |
| Run | W09i, W09j, W09k, WM06 | blocked run, runtime expression errors → DLQ, slow engine, crash/OOM, determinism |
| History | W09m, W09n | 100-step limit, undo while running pauses first, labelled history |
| Persist | WX04, WX08 | quota full, storage blocked (private mode), two tabs, unload flush |
| Scale and devices | WX10, WX09 | 150+ nodes performance mode, small screens |
| Data | W12*, W13*, WX06 | bad rows, missing columns, 200 MB limit, versioned reference tables |
| Learn the UI | T01–T06, E01–E06 | skip, resume, element moves (ResizeObserver) |
| Leave the simulator | W17*, W18*, WX05 | unsupported export nodes, no desktop app, link too long, broken link |

## Connecting to Flink clusters: coverage

| Area | Covered by | Edge cases handled |
|---|---|---|
| Choose the platform | C01 | self-managed, K8s, YARN, gateway/proxy, Ververica (limited), AWS Managed (limited, read-only), Confluent Cloud (not supported, explained) |
| Form | D02, D02b, D02c, C02 | invalid URL, duplicate name, required fields, base path, custom headers, Authorization blocked from headers, proxy, timeouts, separate gateway |
| Auth and transport | D02g (SSH), D02h (K8s), D02i (mTLS), C03 (cert trust) | key rejected, context missing, unreadable PEM, self-signed, pinned cert changed, keychain locked |
| Test | D02d, D02e, D02f, C04 | DNS, refused, timeout, TLS, proxy 407, SSO HTML page, wrong base path, not Flink, old version, partial pass → read-only, gateway down |
| Live connection | D03e, D04b–d, X11, X12, C06, C07 | lost contact with back-off, offline, slow cluster, partial TM data, HA leader change, managed link expired, 429 |
| Auth during use | X08, X09 | 401 re-login without losing work, 403 for actions |
| Versions | C05 | capability table 1.17 → 2.3+, hidden features explained |
| Actions safety | D15*, X10, X14 | prod type-to-confirm, no savepoint dir, conflicts (409), savepoint timeout, no auto-retry of POSTs |
| SQL | D17*, X01–X07 | syntax, unknown table/column with suggestions, type errors, window GROUP BY, state TTL warnings, run blocked, runtime failure, gateway lost, session expired, truncated results |

## Decisions taken in this audit
1. **All cluster HTTP goes through Rust**, never through the webview. This avoids CORS, keeps secrets out of JS, and gives one place to add auth, TLS and proxies.
2. **There is no write-permission probe.** Flink has no safe "can I stop?" call, so actions handle 403 when used.
3. **Managed platforms are supported only as far as their Flink REST is reachable.** Confluent Cloud is out of scope for v1, and the picker explains why.
4. **Union node added** (multi-input streams were missing from the node set).
5. **Phones get a read-only simulator**; building needs at least 900 px.

## Still open (needs Paramveer's call; not blocking M1–M3)
- Dark theme: the original list wants both themes, but the designs are light only. Ship light, keep the tokens theme-ready.
- Employment contract IP clause: check before publishing (from the original open questions).
- Kerberos/SPNEGO for YARN clusters: rare outside banks. Proposed for later, behind the "token command" escape hatch.
- Telemetry: off by default. An opt-in crash report only (X13).
- Course chapter content: the outline exists, the copy does not. Write it in M5 with the checkers.
