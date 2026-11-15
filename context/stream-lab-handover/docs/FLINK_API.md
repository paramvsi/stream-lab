# Connecting to Flink (desktop)

Boards: `D02*`, `D03*`, `C01`–`C07`, `X08`–`X12`. Codes: `CONN-*`, `API-*`.

> **Check every endpoint against the REST API docs for the connected version** (`/config` → `flink-version`). Supported range: **Flink 1.20 and 2.x**. Anything older gets read-only views on a best-effort basis (`CONN-VERSION-OLD`). The paths below match 1.20 to 2.3. Generate the typed client from Flink's OpenAPI document at `/v1/api-docs` (marked experimental), pinned per supported version, then wrap it. Keep each call in `packages/flink/src/endpoints/*.ts`, with a zod schema for the response, a `// FLINK: <doc url>` comment, and a fixture recorded from a real cluster.

## How the app reaches a cluster

```
React (webview) --invoke--> Rust command `flink_request` --> transport --> cluster
                                                   |-- direct HTTPS (reqwest + rustls; custom CA; pinned certs)
                                                   |-- SSH tunnel (russh local port forward; key read from disk, passphrase from keychain)
                                                   |-- Kubernetes (spawn `kubectl port-forward svc/<name> :8081 -n <ns> --context <ctx>`; watch the process)
                                                   '-- HTTP proxy (system / none / explicit; 407 → CONN-PROXY)
```
- All cluster HTTP goes through **one Rust command**. Do not use `fetch` from the webview: there is no CORS to worry about, secrets never enter JS, and it is easy to audit. JS sends `{connId, method, path, query, body, timeoutMs}`. Rust adds the base URL, base path, auth headers (from the keychain), custom headers and TLS settings.
- Each response returns `{status, headers(subset), body, timing, transport}`. Errors return a typed kind: `dns | refused | timeout | tls_untrusted | tls_changed | tls_other | proxy | ssh_auth | ssh_host_key | k8s | io`. `fromTauriHttp()` maps the kind to `CONN-*`.
- Redaction: Rust never logs the `Authorization` header, or any custom header marked secret.
- Concurrency: at most 6 requests in flight per connection; polls share a scheduler. Pause polling for hidden or minimised windows (configurable).

## Supported platforms (board C01)

| Kind | How | Notes |
|---|---|---|
| Standalone / session | `https://host:8081` | full support |
| Kubernetes (operator or native) | port-forward, or an Ingress URL with a base path | the operator's `FlinkDeployment` status is out of scope for v1 |
| YARN | RM proxy `http://rm:8088/proxy/application_<id>/` as the base path | the app id changes per run, so show a hint |
| Behind a gateway | base path + custom headers / bearer (OIDC token pasted or fetched by a command) | detect HTML login pages: `CONN-SSO-REDIRECT` |
| Ververica Platform | per-deployment Flink UI URL + API token | limited (`warn` badge) |
| Amazon Managed Service for Apache Flink | pre-signed Flink dashboard URL; optional refresh command (`aws kinesisanalyticsv2 create-application-presigned-url …`) | read-only; `CONN-LINK-EXPIRED` |
| Confluent Cloud for Apache Flink | not supported (statement API only) | `CONN-KIND-UNSUPPORTED` |

Verify TLS can be switched off with a warning (`CONN-TLS-VERIFY-OFF`), but not on Production connections.

Auth: none · basic · bearer (static, or a "token command" re-run when a 401 arrives) · mTLS (client cert and key as PEM, plus an optional CA) · custom headers. SQL Gateway: a separate address and login (default: same as REST).

## Test connection (board C04): steps, in order, each shown live
1. Resolve the host → `CONN-DNS`
2. TCP / TLS → `CONN-REFUSED`, `CONN-TIMEOUT`, `CONN-TLS-UNTRUSTED` (offer the C03 trust dialog), `CONN-PROXY`
3. Login → `GET {base}/config`; 401 → `API-401`; HTML or a 3xx to another host → `CONN-SSO-REDIRECT`; 404 → `CONN-BASEPATH`
4. "This is Flink" → `/config` has `flink-version`; otherwise `CONN-NOT-FLINK`; an old version → `CONN-VERSION-OLD`
5. Overview → `GET /overview` (slots, TMs, jobs)
6. Write access → no safe probe exists. Never call stop or cancel to test. If the token claims or the connection is marked read-only, say so; otherwise `CONN-WRITE-PROBE` (info). Actions handle 403 when used (`API-403`).
7. SQL Gateway (if set) → `GET {gw}/v1/info`, then open a session and close it.

Result: all pass → Save. Read checks pass but something else fails → `CONN-TEST-PARTIAL` with "Save as read-only". Save always works, even without a test; the connection is then marked "untested".

## REST endpoints used

| Area | Method + path | Notes |
|---|---|---|
| Version / config | `GET /config` | `flink-version`, `features` (e.g. web-submit, web-cancel), `refresh-interval` |
| Cluster | `GET /overview` | slots total/available, TMs, jobs by state |
| JM config | `GET /jobmanager/config` | `state.savepoints.dir`, `jobmanager.scheduler`, `rest.flamegraph.enabled` |
| JM logs | `GET /jobmanager/logs`, `GET /jobmanager/logs/:name` | |
| TaskManagers | `GET /taskmanagers`, `GET /taskmanagers/:id`, `/metrics?get=…`, `/logs`, `/thread-dump` | |
| Jobs | `GET /jobs/overview` | the list |
| Job | `GET /jobs/:jid`, `/jobs/:jid/config`, `/jobs/:jid/exceptions?maxExceptions=20` (read `exceptionHistory`; `root-exception` and `all-exceptions` are deprecated), `/jobs/:jid/plan` | |
| Vertex | `GET /jobs/:jid/vertices/:vid`, `/subtasks/metrics`, `/backpressure`, `/watermarks`, `/flamegraph?type=on_cpu` | |
| Checkpoints | `GET /jobs/:jid/checkpoints`, `/checkpoints/config`, `/checkpoints/details/:cid` | |
| Savepoint | `POST /jobs/:jid/savepoints` `{target-directory?, cancel-job:false, formatType?}` → `{request-id}`; poll `GET /jobs/:jid/savepoints/:rid` | |
| Stop | `POST /jobs/:jid/stop` `{targetDirectory?, drain}` → poll the savepoint status | never retried automatically |
| Cancel | `PATCH /jobs/:jid?mode=cancel` | prod: type-to-confirm |
| Rescale | `GET`/`PUT /jobs/:jid/resource-requirements` (adaptive scheduler, 1.18+): per-vertex parallelism `lowerBound`/`upperBound`; the PUT must list every vertex | **Do not use `PATCH /jobs/:jid/rescaling`.** It has been disabled since FLINK-12312 and is being removed (FLIP-340). Without the adaptive scheduler: stop with savepoint + resubmit |
| Rescale history (2.3+) | `GET /jobs/:jid/rescales/overview`, `GET /jobs/:jid/rescales/history` (FLIP-495) | adaptive scheduler only |
| JARs | `POST /jars/upload` (multipart), `GET /jars`, `POST /jars/:jarid/run` `{entryClass, programArgsList, parallelism, savepointPath, allowNonRestoredState}`, `DELETE /jars/:jarid` | needs `web.submit.enable` |
| Applications (2.3+) | as documented for that version | hide below 2.3 (`CONN-FEATURE-VERSION`) |

## SQL Gateway endpoints

| Step | Call |
|---|---|
| Info | `GET /v1/info` (or `/v2/info`) |
| Open a session | `POST /v1/sessions` `{properties}` → `sessionHandle` |
| Keep it alive | `POST /v1/sessions/:sh/heartbeat` every 30 s while the tab is open |
| Run a statement | `POST /v1/sessions/:sh/statements` `{statement, executionTimeout?}` → `operationHandle` |
| Fetch results | `GET /v1/sessions/:sh/operations/:oh/result/:token` (v2 adds `?rowFormat=JSON`); follow `nextResultUri` until `resultType=EOS` |
| Status / cancel / close | `GET …/operations/:oh/status`, `POST …/operations/:oh/cancel`, `DELETE …/operations/:oh/close` |
| Close the session | `DELETE /v1/sessions/:sh` when the tab closes |

## Polling defaults
| Data | Interval | On error |
|---|---|---|
| Fleet health | 15 s | stale badge after 2 failures |
| Job list | 5 s | banner after 3 failures (back-off) |
| Open job overview / metrics | 2 s (visible tab only) | |
| Checkpoints | 5 s | |
| Logs (follow) | 2 s, incremental by size | |

## Fixtures and the test matrix
- `docker/` has docker-compose files for Flink **1.20, 2.0, 2.2, 2.3**, each a session cluster + SQL Gateway + Kafka. Add a Caddy reverse proxy with a base path and basic auth, a self-signed TLS variant, and an mTLS variant.
- Contract tests run every endpoint schema against each version (CI matrix). Record fixtures with `pnpm fixtures:record`.
