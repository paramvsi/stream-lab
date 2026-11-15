# Error catalog

Every error, warning and notice in Stream Lab. **Single source of truth**: `seed/error-catalog.ts` is generated from the same list; copy it to `packages/errors/src/catalog.ts`.

Rules for implementers:

1. Never show an error that is not in this catalog. A new case means a new row here first, in the same PR.
2. `{placeholders}` are filled from typed params; no raw exception text in the main message. Raw detail goes behind "Copy details".
3. Each code has exactly one primary placement (see `docs/ERRORS_AND_ALERTS.md`). Do not also toast it.
4. Every code needs a test that triggers it and asserts the message, placement and actions (`TESTING.md`).
5. "Board" is the design artboard that shows it. `W…/WX…` are in the Website canvas, `D…/X…/G…` in the Desktop canvas.

Total: **136 codes** (128 from the handover + `CONN-SSH-HOSTKEY`, `API-4XX`, `COPY-FAILED` added in M0, `SIM-DUP-EDGE`, `SIM-PORT-TAKEN`, `SIM-REDO-EMPTY`, `PIPELINE-NOT-FOUND`, `PIPELINE-DELETED-ELSEWHERE` added in M1).


## Desktop · Connections

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `CONN-URL-INVALID` | REST URL field is not a valid http(s) URL | URL parse on blur + on save | error | field | Enter a full address like https://flink.example.com:8081. | — | D02c |
| `CONN-NAME-TAKEN` | Connection name already used | Case-insensitive compare with saved names | error | field | A connection called "{name}" already exists. | — | D02c |
| `CONN-REQUIRED` | A required field is empty on Save/Test | Schema validation (zod) | error | field | {field} is required. | — | D02c |
| `CONN-DNS` | Host name does not resolve | Tauri HTTP error kind = dns | error | panel (test result) | Could not find {host}. Check the address or your VPN. | Edit address, Copy details | D02f |
| `CONN-REFUSED` | TCP connection refused | error kind = connect / ECONNREFUSED | error | panel (test result) | Nothing is listening on {host}:{port}. Is the JobManager running and the port right? | Retry, Copy details | D02f |
| `CONN-TIMEOUT` | No answer within the connection timeout (default 10 s) | AbortController timeout | error | panel (test result) | {host} did not answer in {timeout} s. | Retry, Raise timeout | D02f |
| `CONN-TLS-UNTRUSTED` | Server certificate is not trusted / hostname mismatch | TLS error from HTTP plugin | error | panel (test result) | The certificate for {host} is not trusted ({reason}). | Add CA file, Copy details | D02f |
| `CONN-NOT-FLINK` | Endpoint answers but /config or /overview is not Flink JSON | Response shape check | error | panel (test result) | {url} answered, but it is not a Flink REST API. Check the port (usually 8081). | Edit address | D02f |
| `CONN-VERSION-OLD` | Flink version below the supported range (1.20 and 2.x) | GET /config flink-version | warning | panel (test result) | Flink {version} is older than 1.20. Read-only views work on a best-effort basis; actions and SQL are hidden. | Continue | D02e |
| `CONN-SSH-AUTH` | SSH tunnel: key rejected or passphrase wrong | Tunnel process exit / auth error | error | field (SSH section) | The SSH server rejected the key for {user}@{bastion}. | Choose another key | D02g |
| `CONN-SSH-HOSTKEY` | SSH tunnel: the bastion host key is unknown or differs from the one on record | Host-key compare in Rust (`tunnel_open`) | error | dialog | The SSH host key for {bastion} does not match the one on record. This can mean an attack or a reinstall. | Review and trust, Disconnect | D02g (not drawn) |
| `CONN-K8S-CONTEXT` | Kubernetes: context or service not found | kubectl port-forward error | error | field (K8s section) | Service {svc} was not found in namespace {ns} (context {ctx}). | Pick context | D02h |
| `CONN-MTLS-FILE` | mTLS cert/key file missing or unreadable or not PEM | File read + PEM parse | error | field | Could not read {file}: {reason}. | Choose file | D02i |
| `CONN-IMPORT-INVALID` | Imported connections file is not valid | JSON schema validation | error | dialog | {file} is not a Stream Lab connections file (line {line}: {reason}). Nothing was imported. | Choose another file | D03b |
| `CONN-IMPORT-DUP` | Imported names clash with existing ones | Name compare | warning | dialog | {n} connections already exist. Choose: skip, replace or keep both. | Skip, Replace, Keep both | D03b |
| `CONN-LOST` | An open connection stops answering (3 failed polls) | Poll loop failure counter | warning | banner | Lost contact with {conn}. Retrying every {s} s; showing data from {ago}. | Retry now | D03e |
| `CONN-OFFLINE` | The computer has no network | navigator.onLine + failed requests | warning | banner | You are offline. Data is from {ago}; actions are paused. | — | D04d |
| `CONN-KEYCHAIN` | OS keychain locked or denied | keyring plugin error | error | dialog | Stream Lab could not read the saved secret for {conn} from the keychain. | Try again, Enter secret | X08 |

## Desktop · Connect any cluster

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `CONN-KIND-UNSUPPORTED` | User picks a platform we do not support (Confluent Cloud Flink) | Connection kind | info | inline in kind picker | {kind} uses a different API. Not supported in this version. | Learn more | C01 |
| `CONN-CERT-UNTRUSTED-PROMPT` | Self-signed / private CA certificate on Test | TLS error with peer cert available | warning | dialog | {host} presented a certificate your computer does not trust. Trust it only if the fingerprint matches. | Trust this certificate, Add CA file, Cancel | C03 |
| `CONN-CERT-CHANGED` | A pinned (trusted) certificate changed | Fingerprint compare | error | dialog | The certificate for {host} changed since you trusted it. This can mean an attack or a renewal. | Review and trust, Disconnect | C03 |
| `CONN-HEADER-AUTH` | User adds Authorization as a custom header | Header name check | error | field | Use the Login section for Authorization so it is stored in the keychain and redacted. | — | C02 |
| `CONN-BASEPATH` | /config 404 but host answers (missing/wrong base path, YARN proxy) | 404 on {base}/config, 200 on host | error | panel (test result) | {url} answered but /config was not found. Check the base path (YARN: /proxy/application_…/). | Edit base path | C04 |
| `CONN-SSO-REDIRECT` | Gateway answers with an HTML login page or 302 to an SSO page | Content-Type text/html or 3xx to another host | error | panel (test result) | {host} sent a sign-in page instead of Flink data. Add the token or header your gateway expects. | Open advanced | C04 |
| `CONN-TEST-PARTIAL` | Test passes read checks but write or gateway checks fail | Each test step result | warning | panel (step list) | Connected, but {failed}. Save as read-only? | Save as read-only, Save anyway, Edit | C04 |
| `CONN-WRITE-PROBE` | Permission probe for actions | OPTIONS or harmless call; never a real stop | info | panel (step list) | Could not confirm write access without changing a job. Actions will ask at use. | — | C04 |
| `CONN-HA-FAILOVER` | JobManager leader changes (HA) | Address in /jobmanager/config or 503 then recover; multiple addresses configured | warning | banner | The JobManager leader changed. Reconnected to {jm}. Jobs are recovering from checkpoint {id}. | View recovery | C06 |
| `CONN-LINK-EXPIRED` | Managed service pre-signed URL expired | 403/401 with expired signature | warning | full-page state | The access link for {conn} expired. Paste a new one or set a refresh command. | Paste new link, Set refresh command | C07 |
| `CONN-FEATURE-VERSION` | Feature not available on this Flink version | Capability table by version | info | banner + hidden action | Some features are hidden because this cluster runs Flink {version}. | See what works | C05 |
| `CONN-PROXY` | HTTP proxy refuses or needs auth (407) | HTTP 407 / proxy connect error | error | panel (test result) | The proxy {proxy} refused the connection ({status}). | Edit proxy | C02 |
| `CONN-TLS-VERIFY-OFF` | User turns off certificate verification | Toggle | error | banner (form) + badge on connection | Certificate checks are off for {conn}. Not allowed for Production connections. | Turn back on | C08 |
| `HISTORY-FULL` | Local history reaches its size limit | SQLite size check | warning | banner (settings) + toast once | History is full. The oldest days are being removed. | Raise limit, Clear history | X19 |
| `FLEET-PARTIAL` | Cross-cluster job list: some connections did not answer | Per-connection query status | warning | banner | {n} connections did not answer ({names}). Their jobs are missing from this view. | Retry | X18 |
| `SQL-SAVE-CONFLICT` | Saving a query over an existing name | Name compare | warning | inline banner | Saving "{name}" will replace the saved version from {ago}. | Replace, Save as new | X16 |
| `SUBMIT-SP-MISSING` | Saved run configuration restores from a savepoint that no longer exists | Savepoint path check before run | error | banner | This configuration restores from {sp}, which was deleted. | Pick savepoint | X17 |

## Desktop · Any API call

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `API-401` | Token missing, wrong or expired | HTTP 401 | error | dialog | Sign in again to {conn}. The cluster rejected the token. | Reconnect, Disconnect | X08 |
| `API-403` | Token can read but not do this action | HTTP 403 | error | toast | {action} was refused: your access does not allow it (403). | Details | X09 |
| `API-404-JOB` | Job/vertex/TM disappeared between list and detail | HTTP 404 on a detail route | info | full-page state | This {thing} no longer exists on {conn}. It may have finished and been cleaned up. | Back to list | D07c |
| `API-409` | Conflicting operation already in progress | HTTP 409 or Flink "already in progress" message | warning | dialog | {job} is already {state}. Stream Lab will follow that operation. | Watch progress, Close | X10 |
| `API-5XX` | JobManager internal error | HTTP 500-599 | error | toast | {conn} had an internal error while {verb}. | Retry, Copy details | X09 |
| `API-4XX` | The cluster refused a request for a reason without its own code (400, 405, 415…) | `fromHttp` fallback for 4xx | error | toast | {conn} refused this request (HTTP {status}). | Copy details | X09 (not drawn) |
| `API-TIMEOUT` | Request exceeds request timeout (default 10 s) | AbortController | warning | banner | {conn} is slow to answer. Retrying in {s} s (attempt {n} of 5). | Retry now, Raise timeout | X12 |
| `API-PARTIAL` | Some TaskManagers/subtasks did not report metrics | Missing ids in metrics response | warning | banner + row badge | {n} of {total} TaskManagers did not answer. Their values are from {ago} and marked stale. | Retry | X11 |
| `API-SHAPE` | Response JSON does not match the expected schema | zod parse failure | error | inline in widget | Could not read this part of the response. Other panels still work. | Copy details | X11 |
| `COPY-FAILED` | "Copy details" could not write to the clipboard (insecure context or permission denied) | `navigator.clipboard` missing or rejected | warning | toast | Could not copy to the clipboard. Your browser blocked it. | — | X00 (not drawn) |
| `API-RATE` | Too many requests (429) or poll budget exceeded | HTTP 429 | warning | banner | The cluster asked us to slow down. Refresh is now every {s} s. | — | X12 |

## Desktop · Jobs

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `JOB-FAILED` | Job state becomes FAILED | State transition in poll | error | object badge + banner on job page + OS notification if rule exists | {job} failed: {root cause first line}. | Open exceptions, Restart from savepoint | D11 |
| `JOB-RESTARTING` | Job restarting (state RESTARTING or numRestarts grows) | State/metric change | warning | object badge + banner | {job} restarted {n} times in {period}. Last cause: {cause}. | Open exceptions | D08c |
| `JOB-BACKPRESSURE` | Operator backpressure HIGH (>50% busy/backpressured) | Vertex backpressure endpoint | warning | object badge on operator | {operator} is backpressured {pct}% of the time. | Open operator | D08b |
| `JOB-WM-STALL` | Watermark has not advanced for > 2 min while records arrive | currentInputWatermark metric | warning | object badge on operator | Watermark at {operator} has been stuck at {time} for {dur}. An idle partition is a common cause. | Learn why, Open watermarks | D09b |
| `JOB-CKPT-FAIL` | Checkpoint failed or exceeds timeout | /checkpoints counts.failed grows | warning | banner on checkpoints tab + badge | Checkpoint {id} failed after {dur}: {reason}. | Open checkpoint | D12b |
| `JOB-CKPT-NONE` | Checkpointing is disabled for a streaming job | checkpoint config interval = -1 | info | inline note | Checkpointing is off for this job, so it cannot recover state after a failure. | Learn more | D12 |
| `JOB-READONLY` | Connection marked read-only or token lacks write | Connection setting | info | banner | This connection is read-only. Actions are hidden. | — | D08e |

## Desktop · Job actions

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `SP-DIR-MISSING` | Stop/trigger savepoint with no state.savepoints.dir and no folder entered | /jobmanager/config lookup | error | field (dialog) | This cluster has no default savepoint folder. Enter one the JobManager can write to. | — | X14 |
| `SP-FAILED` | Savepoint operation returns FAILED | Poll /jobs/:id/savepoints/:trigger | error | dialog (result step) | Savepoint failed: {reason}. The job is still running. | Try again, Copy details | D15d |
| `SP-TIMEOUT` | Savepoint still IN_PROGRESS after 10 min | Poll timer | warning | dialog | The savepoint is taking longer than usual ({dur}). You can keep waiting or close this; it continues on the cluster. | Keep waiting, Close | D15b |
| `CANCEL-PROD` | Cancel on a connection tagged prod | Connection env tag | warning | dialog (type-to-confirm) | Cancel {job} on production without a savepoint? Its state will be lost. | Stop with savepoint instead, Cancel job | D15e |
| `RESCALE-UNSUPPORTED` | Rescale requested but scheduler is not adaptive | jobmanager.scheduler config | info | dialog | Rescaling in place needs the adaptive scheduler. You can stop with a savepoint and resubmit with a new parallelism. | Stop and resubmit | D15g |
| `RESCALE-SLOTS` | Requested parallelism exceeds free slots | /overview slots-available | error | field | Needs {need} slots; only {free} are free. | — | D15g |

## Desktop · Submit JAR

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `SUBMIT-NOT-JAR` | File is not a JAR / zip | Magic bytes check | error | field (drop zone) | {file} is not a JAR file. | Choose another | D16-Submit-err |
| `SUBMIT-TOO-LARGE` | JAR bigger than web.upload limit / rest.server.max-content-length | Size vs config | error | field | {file} is {size}; this cluster accepts up to {max}. | — | D16-Submit-err |
| `SUBMIT-NO-MAIN` | No entry class in manifest and none entered | Flink response | error | field | No main class found. Enter the entry class. | — | D16-Submit-err |
| `SUBMIT-ARGS` | Program arguments have unbalanced quotes | Client parse | error | field | Unclosed quote in arguments at character {pos}. | — | D16-Submit-config |
| `SUBMIT-SP-INCOMPAT` | Restore from savepoint fails because of unmapped state | Flink exception text | error | panel (result) | The savepoint has state for operators that no longer exist. Turn on "Allow non-restored state" only if you mean to drop it. | Allow and retry, Copy details | D16-Submit-err |
| `SUBMIT-PROGRAM` | Job main() throws during submission | Flink error list | error | panel (result) | The job failed to start: {first line}. | Copy details | D16-Submit-err |

## Desktop · SQL editor

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `SQL-NO-GATEWAY` | Connection has no SQL Gateway URL or it does not answer | GET {gw}/v1/info | info | full-page state | SQL needs the Flink SQL Gateway (port 8083). Add its address to this connection. | Edit connection, Learn how | D17-SQL-nogw |
| `SQL-PARSE` | Syntax error | Local: tokenizer + bracket/quote/semicolon checks as you type (debounce 300 ms). Server: EXPLAIN via gateway on pause (debounce 800 ms) → SqlParseException "at line L, column C" | error | inline (squiggle + gutter + hover) + Problems tab | Syntax error at line {l}: {expected}. | Quick fix (when known), Copy details | X01 |
| `SQL-UNKNOWN-TABLE` | Table/view not in catalog | Local catalog cache (SHOW TABLES) + server "Object ... not found" | error | inline + Problems | Table "{t}" not found in {catalog}.{db}. Did you mean "{s}"? | Replace with suggestion, Show catalog | X02 |
| `SQL-UNKNOWN-COLUMN` | Column not found | Local schema cache (DESCRIBE) + server "Column ... not found" | error | inline + Problems | Column "{c}" not found in {t}. Did you mean "{s}"? | Replace | X04 |
| `SQL-TYPE` | Type mismatch (e.g. SUM over STRING) | Server validation only | error | inline + Problems | Cannot apply {fn} to {type}. | Copy details | X04 |
| `SQL-WINDOW-GROUP` | Window TVF aggregate GROUP BY misses window_start/window_end | Local rule + server | warning | inline + Problems | GROUP BY must include window_start and window_end for this window aggregate. | Add window_end | X04 |
| `SQL-STATE-TTL` | Regular join / unbounded GROUP BY / DISTINCT without table.exec.state.ttl | Local rule on AST | warning | inline + Problems | This {op} keeps state forever. Set a state TTL or use an interval/window join. | Use interval join, Set state TTL, Ignore | X03 |
| `SQL-MULTI-STMT` | Several statements and Run (not Run all) pressed | Statement splitter | info | inline | Running the statement at the cursor (line {l}). | Run all | D17-SQL-run |
| `SQL-RUN-BLOCKED` | Run pressed while errors exist | Problems count > 0 | error | inline next to Run + tooltip | Fix {n} error(s) to run. | Go to first error | X04 |
| `SQL-RUNTIME` | Statement accepted, then the job fails | Operation status ERROR / job FAILED | error | banner above results | The statement started, then failed after {dur}: {cause}. | Open job, Run again, Copy details | X05 |
| `SQL-SESSION-EXPIRED` | Gateway session expired (idle timeout) | 404 on session handle | warning | banner | The SQL session expired. A new one was opened; SET options were re-applied. | — | X06 |
| `SQL-GATEWAY-LOST` | Gateway stops answering while results stream | Fetch failures x3 | warning | banner + dimmed results + status badge | Lost connection to the SQL Gateway. The query may still be running. Reconnecting in {s} s. | Reconnect now | X06 |
| `SQL-TRUNCATED` | Result rows exceed view limit (default 10,000) | Row counter | info | banner | Showing the latest {n} rows. Older rows were dropped from the view; the query is unaffected. | Change limit | X07 |
| `SQL-CANCELLED` | User cancels a running statement | User action | success | toast | Query stopped. | — | D17-SQL-run |

## Desktop · Logs, alerts, app

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `LOG-TOO-LARGE` | Log file > 50 MB | Content-Length | info | banner | This log is {size}. Showing the last 5,000 lines. | Load more, Download full | D18 |
| `LOG-REGEX` | Invalid regex in log filter | new RegExp try/catch | error | field | That pattern is not valid: {reason}. | — | D18b |
| `PROFILER-OFF` | Flame graph requested but rest.flamegraph.enabled is false | Endpoint 404/disabled | info | full-page state in tab | Flame graphs are off on this cluster. Set rest.flamegraph.enabled: true. | Copy setting | D19b |
| `ALERT-RULE-INVALID` | Alert rule incomplete or threshold not a number | Form schema | error | field | {field}: {reason}. | — | D20c |
| `ALERT-NOTIFY-DENIED` | OS notification permission denied | notification plugin | warning | banner (alerts page) | Notifications are blocked for Stream Lab, so alerts only show inside the app. | Open system settings | D20 |
| `ALERT-FIRED` | A rule fires | Rule engine | warning|error (rule severity) | OS notification + alerts list + object badge | {rule}: {metric} is {value} on {job}. | Open job, Mute 1 h | D20d |
| `UPDATE-FAILED` | Updater download/signature fails | updater plugin error | error | banner (settings) | Update to {v} failed: {reason}. Nothing was installed. | Try again, Download manually | X15 |
| `APP-CRASH-RECOVERED` | App starts after an unclean exit | Lock file present on start | warning | dialog | Stream Lab closed unexpectedly. Your connections and tabs were restored. | Continue, Copy report | X13 |
| `APP-UNSAVED` | Closing a tab/window with unsaved SQL or form | Dirty flag | warning | dialog | Close without saving {thing}? | Save, Don't save, Cancel | G01 |

## Web · Simulator canvas

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `SIM-NO-SOURCE` | Run with no Source/Generator node | Graph validation before run | error | Problems tab + Run tooltip | Add a Source to start the pipeline. | Add Source | W09l |
| `SIM-NO-SINK` | A path ends without a Sink or Dead-letter | Graph validation | warning | object badge + Problems | {node} output goes nowhere. Events will be dropped. | Add Sink here | W09l |
| `SIM-DISCONNECTED` | Node with no input (other than sources) | Graph validation | error | object badge + Problems | {node} has no input. | Select node | W09l |
| `SIM-CYCLE` | Connection would create a cycle | isValidConnection with getOutgoers DFS | error | inline at cursor while dragging (connection refused) | This would make a loop. Streams must flow one way. | — | W09e |
| `SIM-DUP-EDGE` | Connecting two ports that are already connected | `isValidConnection` | error | inline at cursor (refused) | These two ports are already connected. | – | W09e (not drawn) |
| `SIM-PORT-TAKEN` | Connecting into a single-input port that already has an edge | `isValidConnection` (port arity) | error | inline at cursor (refused) | {port} on {node} already has an input. Remove that edge first. | – | W09e (not drawn) |
| `SIM-PORT-TYPE` | Connecting incompatible ports (e.g. late output into Join right side with other schema) | isValidConnection schema check | error | inline at cursor (refused) | Schemas do not match: {a} has {has}, {b} needs {needs}. | — | W09e |
| `SIM-SCHEMA-DRIFT` | Upstream schema change breaks a downstream field reference | Re-validate on every graph change | error | object badge + Problems + field error in drawer | {node} uses "{field}", which {upstream} no longer outputs. | Open node | W09l |
| `SIM-RUN-BLOCKED` | Run pressed while errors exist | Problems count | error | Run button tooltip + Problems tab opens | Fix {n} error(s) to run. | Go to first error | WX02 |
| `SIM-ENGINE-CRASH` | Worker throws or runs out of memory | worker.onerror / onmessageerror / heartbeat miss 3 s | error | dialog | The simulator stopped at event {n}: {reason}. Your pipeline is safe. | Reload simulator, Copy details | WX03 |
| `SIM-SLOW` | Events/s below 20% of target for 5 s | Engine stats | info | toast | Running slower than {speed}. Try fewer events. | Lower speed | W09i |
| `SIM-RUNTIME-EXPR` | Expression throws at runtime for an event (e.g. divide by zero, null field) | Engine try/catch per event | warning | node badge count + Problems row + event marked in Timeline | {n} events failed in {node}: {reason}. They were sent to Dead-letter. | Show events | W09l |
| `SIM-DELETE-UNDO` | Node(s) deleted | User action | success | toast with Undo (8 s) | Deleted {n} node(s). | Undo | W09n |
| `SIM-UNDO-EMPTY` | Undo with no history | History stack | info | button disabled + tooltip | Nothing to undo. | — | W09m |
| `SIM-REDO-EMPTY` | Redo with nothing to redo | Empty redo stack | info | button disabled + tooltip | Nothing to redo. | — | W09m |
| `SIM-TAB-CONFLICT` | Same pipeline edited in two tabs | BroadcastChannel + version counter in IndexedDB | warning | banner | This pipeline is open in another tab, which saved a newer version. | Load newer version, Keep editing here | WX08 |
| `PIPELINE-NOT-FOUND` | Opening /sim/:id for a pipeline that is not saved in this browser | `getPipeline` returns nothing | info | full-page state | This pipeline is not saved in this browser. It may have been deleted, or made in another browser. | My pipelines, New pipeline | W09 (not drawn) |
| `PIPELINE-DELETED-ELSEWHERE` | The open pipeline was deleted in another tab | BroadcastChannel `deleted` message | warning | banner | This pipeline was deleted in another tab. Changes here are no longer saved. | Keep a copy, Close | WX08 (not drawn) |
| `SIM-SMALL-SCREEN` | Viewport < 900 px wide | matchMedia | info | full-page state | The builder needs a wider screen. You can watch scenarios and read the course. | Watch scenario, Email me the link | WX09 |
| `SIM-LARGE-GRAPH` | More than 150 nodes | Node count | info | toast | Edge animation and live counts are reduced to keep it smooth. | Settings | WX10 |
| `SIM-UNION-SCHEMA` | Union inputs have different schemas | Schema compare | error | object badge + field | Union inputs must match. {a} has {x}; {b} has {y}. | Add Map before union | W10-* |

## Web · Node config

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `NODE-REQUIRED` | Required setting empty | Per-node zod schema | error | field + node badge | {field} is required. | — | W10-* |
| `CEL-PARSE` | Filter/Validate/Route/Map expression does not parse | cel-js parse on keystroke (debounce 200 ms) | error | inline in expression editor + node badge | Expression error at column {c}: {reason}. | — | WX01 |
| `CEL-UNKNOWN-FIELD` | Expression uses a field not on the input edge | Type-check against input schema | error | inline + quick fix | Unknown field "{f}". Fields here: {list}. | Replace with suggestion | WX01 |
| `CEL-TYPE` | Expression type wrong (Filter not boolean, Map type mismatch) | Type-check | error | inline | This must return {expected}; it returns {actual}. | — | W10-Filter |
| `WIN-SIZE` | Window size ≤ 0, slide > size, or session gap ≤ 0 | Schema | error | field | {reason}. | — | W10-Window |
| `WIN-NO-TIME` | Event-time window but source has no watermark/time field | Graph check | error | field + node badge | Pick an event-time field on {source}, or switch to processing time. | Open source | W10-Window |
| `WM-LATENESS-BIG` | Allowed lateness > window size × 10 | Schema rule | warning | field | Lateness of {x} keeps windows open a long time and holds state. | — | W10-Source |
| `LOOKUP-NO-TABLE` | Lookup references a missing or empty reference table | Data store | error | field | Reference table "{t}" is empty or missing. | Open reference tables | W10-Lookup |
| `LOOKUP-KEY-TYPE` | Lookup key type differs from table key | Schema compare | error | field | Key types differ: {a} vs {b}. | — | W10-Lookup |
| `JOIN-NO-BOUND` | Join without interval/window bound | Node config | warning | field + node badge | Unbounded join: state grows forever. Set a time bound. | Set 1 h bound | W10-Join |
| `DEDUP-NO-TTL` | Deduplicate without TTL | Node config | warning | field | Without a TTL, every key is remembered forever. | Set TTL | W10-Dedup |
| `PATTERN-INVALID` | Pattern step missing a condition or times range invalid | Schema | error | field | Step {n}: {reason}. | — | W10-Pattern |
| `ROUTE-OVERLAP` | Route branches overlap or no default branch | Static analysis where possible | warning | field | No default branch: events matching no rule are dropped. | Add default | W10-Route |
| `SQLNODE-UNSUPPORTED` | SQL node uses syntax the simulator does not support | Simulator SQL subset parser | error | inline | The simulator does not support {feature}. It will work on a real cluster; export to try it. | Export SQL | W10-SQLNode |

## Web · Data, storage, share, browser

| Code | When | How we detect it | Severity | Placement | Message | Actions | Board |
|---|---|---|---|---|---|---|---|
| `DATA-PARSE` | Uploaded CSV/JSONL rows fail to parse | Row parser | warning | panel (upload) with row list | {n} of {total} rows could not be read (first: line {l}: {reason}). | Skip bad rows, Download report | W12c |
| `DATA-SCHEMA` | Uploaded rows miss fields the source schema requires | Schema compare | error | panel | Column "{c}" is missing; the Source schema needs it. | Map columns | W12c |
| `DATA-TOO-LARGE` | File > 200 MB | File.size | error | panel | {file} is {size}. The simulator handles up to 200 MB per file. | Read first 200 MB, Choose another | WX06 |
| `GEN-INVALID` | Generator settings invalid (rate ≤ 0, late % > 100) | Schema | error | field | {reason}. | — | W12 |
| `STORE-FULL` | IndexedDB/OPFS quota exceeded on save | QuotaExceededError | error | banner (persistent) | Can not save: browser storage is full ({used}). | Manage storage | WX04 |
| `STORE-BLOCKED` | Storage unavailable (private mode, blocked) | IndexedDB open fails | warning | banner | This browser is not letting Stream Lab save. Work will be lost when you close the tab. | Export now | WX04 |
| `IMPORT-INVALID` | Imported pipeline JSON invalid or from a newer version | zod + version field | error | dialog | {file} could not be imported: {reason}. | Choose another | W08c |
| `SHARE-TOO-LONG` | Share URL > 8,000 chars | Encoded length | warning | field (share dialog) | This link is {n} characters; some apps cut long links. | Leave out data, Export JSON, Copy anyway | WX05 |
| `SHARE-BROKEN` | Opening a share link that will not decode | Decode/validate | error | full-page state | This link is damaged or incomplete. | Open a new pipeline | W18 |
| `EXPORT-UNSUPPORTED` | Pipeline uses a node with no Flink SQL equivalent | Exporter | warning | banner in export dialog | {node} has no direct Flink SQL; it is exported as a comment with a TODO. | — | W17 |
| `DESKTOP-NOT-FOUND` | Send to desktop: app does not answer the deep link in 4 s | Timeout after streamlab:// open | info | dialog | Stream Lab desktop did not open. Install it, or copy the SQL. | Download, Copy SQL | W17e |
| `BROWSER-UNSUPPORTED` | No Worker/WASM/IndexedDB support | Feature detection on load | error | full-page state | This browser can not run the simulator. You can still read every chapter. | Read the course | WX07 |
| `COURSE-WRONG` | Challenge answer does not meet the check | Challenge checker | warning | inline under the challenge | Not yet: {hint}. | Show hint, Reset | W05d |
