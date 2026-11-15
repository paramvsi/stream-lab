# Testing

| Layer | Tool | What | Gate |
|---|---|---|---|
| Unit | Vitest | engine semantics, graph validation, node schemas, SQL lint, error mappers, migrations, SQL export | 90% lines in engine/graph/sql/errors |
| Catalog | Vitest | every catalog code renders via `present()` with sample params; every code has ≥ 1 test that triggers it (script greps test names for codes) | 100% codes |
| Component | Testing Library + Storybook interaction tests | each board state as a story; keyboard paths; focus return | all stories pass |
| Visual | Playwright screenshots of stories vs approved baselines (1440×900) | regressions | < 0.1% diff |
| A11y | axe-core on every story and route | AA | 0 violations |
| E2E web | Playwright | build pipeline from blank → run → explain → export; every SIM/NODE/DATA error case | all FEATURES v1 IDs |
| E2E desktop | Playwright + tauri-driver | connect (each transport/auth variant from `docker/`), job actions on a real job, SQL X01–X07 | matrix 1.20 / 2.0 / 2.2 / 2.3 |
| Contract | Vitest | zod schemas vs recorded fixtures per Flink version | all endpoints |
| Fidelity | Vitest + docker Flink | each scenario's golden output vs a real Flink run (ENG-06) | exact match, or a documented difference |
| Performance | Vitest bench + Playwright | 10k events in under 2 s (ENG-01); 100-job list renders in under 1 s; 150-node canvas at 60 fps pan | budgets met |
| Fault injection | toxiproxy in docker | latency, drop, 5xx, TLS swap, leader kill (HA compose) | `CONN-*`, `API-*` behave per catalog |

Naming: `describe('SIM · connecting')`, `it('SIM-07 rejects a cycle with SIM-CYCLE')`.
CI: lint, typecheck, unit, catalog, component, a11y on every PR; e2e + matrix nightly and on release branches.
