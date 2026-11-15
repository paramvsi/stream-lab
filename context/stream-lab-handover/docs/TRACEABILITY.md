# Traceability: original feature list → handover

Source: "Stream Lab — Research & Feature List" (https://claude.ai/artifact/R537ns1aG4pyZZ3vkKAcqS). Every one of its **77 features** is mapped below to acceptance criteria in `FEATURES.md` and to boards. **The priority column (MVP / v1 / Later) comes from the original list and overrides anything else.** Build MVP first, as in the release plan.

Mapped: **77 of 77**. With no board yet: 2, both marked Later.

| ID | Feature | Priority | Criteria | Boards |
|---|---|---|---|---|
| L-01 | Chapter format (explain, sandbox, challenge, progress saved) | MVP | LEARN-01..03 | W04*, W05* |
| L-02 | Ch 1 Event time vs processing time | MVP | LEARN-05 | W05* |
| L-03 | Ch 2 Watermarks and late events | MVP | LEARN-05 | W05*, WM01, WM02 |
| L-04 | Ch 3 Windows | MVP | LEARN-05 | W05* |
| L-05 | Ch 4 Aggregations and Top-N | MVP | LEARN-05 | W05* |
| L-06 | Ch 5 Deduplication | MVP | LEARN-05 | W05* |
| L-07 | Ch 6 Joins and versioned lookups | MVP | LEARN-05 | W05* |
| L-08 | Ch 7 State and TTL | v1 | LEARN-05 | W05* |
| L-09 | Ch 8 MATCH_RECOGNIZE | v1 | LEARN-05 | W05* |
| L-10 | Ch 9 Changelogs and retractions | v1 | LEARN-05, ENG-04 | W05* |
| L-11 | Ch 10 Checkpoints, exactly-once, backpressure | v1 | LEARN-05, ENG-05 | W05* |
| L-12 | Concept cards in site and app | MVP | LEARN-04, JOB-10 | W06*, D08f |
| B-01 | Canvas: drag, connect, layout, undo/redo, shortcuts | MVP | SIM-03..13, SIM-22 | W09* |
| B-02 | Core nodes (12) | MVP | NODE-06 | W10*, B03 |
| B-03 | Pattern node | v1 | NODE-06 | W10-Pattern |
| B-04 | Schema on every edge, inferred and editable | MVP | SIM-25 | W10x, W12b |
| B-05 | CEL expressions type-checked | MVP | NODE-03 | W10-Filter, WX01 |
| B-06 | SQL node (DuckDB-WASM) | v1 | NODE-08 | W10-SQLNode |
| B-07 | Live Flink SQL panel | MVP | SIM-21 | W09k, W17 |
| B-08 | Save and share (JSON, # link) | MVP | SIM-02, EXP-04 | W08*, W18*, WX05 |
| D-01 | Fintech payments pack | MVP | DATA-05 | W07, W12 |
| D-02 | E-commerce pack | v1 | DATA-06 | W07 (gallery card) |
| D-03 | Seeded generator | MVP | DATA-01 | W12 |
| D-04 | Upload your own data | MVP | DATA-02 | W12b, W12c, WX06 |
| D-05 | Versioned reference data | MVP | DATA-03 | W13b |
| D-06 | PaySim import | Later | DATA-07 | none yet (later) |
| E-01 | Web Worker, deterministic replay | MVP | SIM-24, ENG-01 | — |
| E-02 | Event time, watermarks, idleness, lateness, late output | MVP | ENG-02 | WM01, WM02, E04 |
| E-03 | Keyed state and parallelism (subtasks, key groups) | MVP | ENG-03 | W10y |
| E-04 | Changelog semantics | v1 | ENG-04 | W10y |
| E-05 | Checkpoints and backpressure simulation | v1 | ENG-05 | W09i |
| E-06 | Fidelity tests vs real Flink in CI | v1 | ENG-06 | — |
| X-01 | Run controls | MVP | SIM-16 | W09i, W09j |
| X-02 | Time scrubber | MVP | EXPL-05 | T05, W09j |
| X-03 | Trace | MVP | EXPL-03 | E06 |
| X-04 | Stage inspector | MVP | EXPL-06 | W10y |
| X-05 | Chaos controls | MVP | SIM-16 | W09i |
| X-06 | What-if compare | v1 | EXPL-04 | E07 |
| X-07 | Expected outputs as tests | v1 | EXPL-04 | E08, E09 |
| G-01 | Download Flink SQL | MVP | EXP-01 | W17 |
| G-02 | Run it for real (docker compose) | v1 | EXP-02 | W17b |
| G-03 | Open in desktop and deploy | v1 | EXP-03, SQL-07 | W17c–f, D17-SQL-incoming |
| C-01 | Profiles with environment tag and colour | MVP | CONN-09 | D03 |
| C-02 | REST URL + optional SQL Gateway URL | MVP | CONN-04 | D02*, C02 |
| C-03 | None, basic, bearer; timeouts, refresh | MVP | CONN-03, CONN-04 | D02*, C02 |
| C-04 | mTLS, custom CA, verify-TLS switch with warning | v1 | CONN-06, CONN-11 | D02i, C03, C08 |
| C-05 | SSH tunnel, Kubernetes port-forward | v1 | CONN-12 | D02g, D02h |
| C-06 | Test connection names failing step (incl. flame graph/profiler enabled) | MVP | CONN-05 | C04, D02d–f |
| C-07 | Secrets in keychain; export without secrets | MVP | CONN-03, CONN-08 | D03b, D03c |
| F-01 | Fleet home | MVP | FLEET-01 | D04* |
| F-02 | Cluster overview | MVP | FLEET-02 | D05* |
| F-03 | Applications view (2.3) | v1 | FLEET-02 | D06 |
| J-01 | Job list with saved views across clusters | MVP | JOB-01, JOB-11 | D07*, X18 |
| J-02 | Job graph coloured by busy/backpressure/skew | MVP | JOB-02 | D08* |
| J-03 | Operator panel | MVP | JOB-03 | D09* |
| J-04 | Local history timeline (SQLite) | MVP | JOB-06 | D10, X19 |
| J-05 | Watermark lag vs wall-clock, holding input | v1 | JOB-07 | D09b |
| J-06 | Grouped exceptions | MVP | JOB-08 | X20, D11 |
| J-07 | Restart and rescale timeline (2.3 rescale history) | v1 | JOB-09 | D10 |
| J-08 | Config compare | v1 | JOB-14 | D13 |
| J-09 | Explain this hints linked to chapters | MVP | JOB-10 | D08f, X20 |
| A-01 | Stop with savepoint as default, drain | MVP | ACT-01 | D15* |
| A-02 | Trigger savepoint and track | MVP | ACT-02 | D15f |
| A-03 | Rescale | v1 | ACT-03 | D15g |
| A-04 | Submit JAR with saved run configurations | v1 | ACT-04, ACT-06 | D16*, X17 |
| A-05 | Prod safety, read-only mode | MVP | ACT-02, CONN-09 | D15e, D08e |
| K-01 | Checkpoint dashboard with slowest operator flagged | MVP | JOB-12 | D12* |
| K-02 | Savepoint catalogue, restore | v1 | JOB-13 | D14* |
| S-01 | SQL editor on the Gateway | v1 | SQL-01..04 | D17*, X01–X07 |
| S-02 | Plan view as a graph | v1 | SQL-05 | D17-SQL-plan |
| S-03 | Deploy from the simulator | v1 | SQL-07 | D17-SQL-incoming |
| S-04 | Saved queries and snippets | v1 | SQL-06 | X16 |
| T-01 | Log viewer | MVP | OPS-01 | D18* |
| T-02 | Thread dump viewer grouped by state | v1 | OPS-02 | D19 |
| T-03 | Flame graphs and profiler in-app | Later | OPS-04 | D19b (design ready) |
| N-01 | Local alerts with OS notifications | v1 | OPS-03 | D20* |
| N-02 | Webhook alerts | Later | OPS-05 | none yet (later) |
