# M6 · Desktop and connections (Phase 2)

Paste everything below the line into Claude Code at the repo root.

---

Read `CLAUDE.md`, then `docs/FLINK_API.md`, `docs/COVERAGE.md`, `docs/FEATURES.md`, `docs/TRACEABILITY.md`.

## Task
Scaffold Tauri 2 in apps/desktop, reusing packages/*. Implement the Rust flink_request command (direct, SSH, kubectl port-forward, proxy; none/basic/bearer/token command/mTLS/custom headers; CA files, pinned certificates, verify-TLS switch; redaction) and the HttpClient side of FlinkClient. Build the platform picker C01, the connection form and advanced settings, the 7-step Test, the certificate trust dialog, keychain storage, import/export without secrets, and the fleet. Add a Caddy base-path proxy, self-signed TLS and mTLS variants to docker/, and run e2e tests against each one.

## Build now (MVP)
- **INST-01** Signed installers: .dmg (universal), .msi/.exe, .AppImage/.deb/.rpm. The splash appears in under 1 s.
- **INST-02** The welcome screen offers Add a connection, Import, and a docker compose hint.
- **CONN-01** The wizard asks where the cluster runs first (C01), then shows the form for that platform.
- **CONN-02** Every field validates on blur and on save (`CONN-URL-INVALID`, `CONN-NAME-TAKEN`, `CONN-REQUIRED`, `CONN-MTLS-FILE`, `CONN-HEADER-AUTH`).
- **CONN-03** Auth types: none, basic, bearer, token command, mTLS, custom headers. Secrets go to the keychain only (`CONN-KEYCHAIN`).
- **CONN-04** Transports: direct and HTTP proxy. Advanced settings: base path, timeouts, poll interval, separate gateway address and login.
- **CONN-05** Test connection runs the 7 steps from FLINK_API.md, live, with an exact result per step (C04). A partial pass offers "Save as read-only".
- **CONN-07** Version detection adapts the UI. Hidden features are explained (C05).
- **CONN-08** Import and export connections as JSON without secrets (`CONN-IMPORT-*`). Delete asks for confirmation.
- **CONN-09** Environment tags (prod/staging/dev), colour-coded everywhere. A read-only flag hides actions.
- **CONN-10** Lost contact, offline, HA failover and expired managed links are handled (`CONN-LOST`, `CONN-OFFLINE`, `CONN-HA-FAILOVER`, `CONN-LINK-EXPIRED`).
- **FLEET-01** The fleet grid shows every connection with health, running/failed jobs and slots, with loading, unreachable and offline states.

## v1: do NOT build in Phase 1/2; leave clean extension points (build only when this prompt is rerun for Phase 3)
- **CONN-06** (v1) Certificate trust dialog with fingerprint; pinned certs; changed-cert warning (`CONN-CERT-*`).
- **CONN-12** (v1) Tunnels: an SSH tunnel, or a Kubernetes port-forward from a kube context, namespace and service (D02g, D02h).
- **CONN-11** (v1) A verify-TLS switch with a persistent warning (`CONN-TLS-VERIFY-OFF`, C08). It is not allowed on Production connections.

## Boards to match (open `design/…/<board>.dc.html`; live canvases are linked in `docs/SCREENS.md`)
- `I01-Mac-DMG`: I01 macOS · disk image window
- `I02-Win-Welcome`: I02 Windows installer · welcome
- `I03-Win-Location`: I03 Windows installer · location
- `I04-Win-Installing`: I04 Windows installer · installing
- `I05-Win-Finish`: I05 Windows installer · finished
- `I06-Splash`: I06 First launch · splash
- `D01-Welcome`: D01 Welcome · no connections yet
- `D02-ConnForm-blank`: D02 Connection form · blank
- `D02b-ConnForm-filled`: D02 Connection form · filled
- `D02c-ConnForm-invalid`: D02 Connection form · validation errors
- `D02d-ConnForm-testing`: D02 Connection form · testing
- `D02e-ConnForm-pass`: D02 Connection form · test passed
- `D02f-ConnForm-fail`: D02 Connection form · test failed at sign-in
- `D02g-ConnForm-ssh`: D02 Connection form · SSH tunnel (v1)
- `D02h-ConnForm-k8s`: D02 Connection form · Kubernetes port-forward (v1)
- `D02i-ConnForm-mtls`: D02 Connection form · certificates (v1)
- `D03-Connections`: D03 Connection manager
- `D03b-Connections-import`: D03 Import connections
- `D03c-Connections-export`: D03 Export connections
- `D03d-Connections-delete`: D03 Delete connection
- `D03e-Unreachable`: D03 Cluster unreachable · full page
- `D04-Fleet`: D04 Fleet · healthy
- `D04b-Fleet-unreachable`: D04 Fleet · one cluster unreachable
- `D04c-Fleet-loading`: D04 Fleet · loading
- `D04d-Fleet-offline`: D04 Fleet · offline, showing cached data
- `C01-Where-is-cluster`: C01 New connection · where does your cluster run?
- `C02-Advanced-settings`: C02 Connection form · advanced: base path, headers, proxy, gateway
- `C03-Trust-certificate`: C03 Untrusted certificate · trust this server?
- `C04-Test-steps`: C04 Test connection · each check shown, one failing
- `C07-Presigned-expired`: C07 Managed service link expired
- `C08-TLS-verify-off`: C08 Connection · certificate checks turned off
- `X08-Session-expired`: X08 Sign-in expired (401)
- `X13-Crash-recovery`: X13 Restarted after a crash

## Error codes this milestone must raise and test (30)
Full rows are in `docs/ERROR_CATALOG.md`.
- `CONN-URL-INVALID` (error, field): Enter a full address like https://flink.example.com:8081.
- `CONN-NAME-TAKEN` (error, field): A connection called "{name}" already exists.
- `CONN-REQUIRED` (error, field): {field} is required.
- `CONN-DNS` (error, panel (test result)): Could not find {host}. Check the address or your VPN.
- `CONN-REFUSED` (error, panel (test result)): Nothing is listening on {host}:{port}. Is the JobManager running and the port right?
- `CONN-TIMEOUT` (error, panel (test result)): {host} did not answer in {timeout} s.
- `CONN-TLS-UNTRUSTED` (error, panel (test result)): The certificate for {host} is not trusted ({reason}).
- `CONN-NOT-FLINK` (error, panel (test result)): {url} answered, but it is not a Flink REST API. Check the port (usually 8081).
- `CONN-VERSION-OLD` (warning, panel (test result)): Flink {version} is older than 1.20. Read-only views work on a best-effort basis; actions and SQL are hidden.
- `CONN-SSH-AUTH` (error, field (SSH section)): The SSH server rejected the key for {user}@{bastion}.
- `CONN-K8S-CONTEXT` (error, field (K8s section)): Service {svc} was not found in namespace {ns} (context {ctx}).
- `CONN-MTLS-FILE` (error, field): Could not read {file}: {reason}.
- `CONN-IMPORT-INVALID` (error, dialog): {file} is not a Stream Lab connections file (line {line}: {reason}). Nothing was imported.
- `CONN-IMPORT-DUP` (warning, dialog): {n} connections already exist. Choose: skip, replace or keep both.
- `CONN-LOST` (warning, banner): Lost contact with {conn}. Retrying every {s} s; showing data from {ago}.
- `CONN-OFFLINE` (warning, banner): You are offline. Data is from {ago}; actions are paused.
- `CONN-KEYCHAIN` (error, dialog): Stream Lab could not read the saved secret for {conn} from the keychain.
- `CONN-KIND-UNSUPPORTED` (info, inline in kind picker): {kind} uses a different API. Not supported in this version.
- `CONN-CERT-UNTRUSTED-PROMPT` (warning, dialog): {host} presented a certificate your computer does not trust. Trust it only if the fingerprint matches.
- `CONN-CERT-CHANGED` (error, dialog): The certificate for {host} changed since you trusted it. This can mean an attack or a renewal.
- `CONN-HEADER-AUTH` (error, field): Use the Login section for Authorization so it is stored in the keychain and redacted.
- `CONN-BASEPATH` (error, panel (test result)): {url} answered but /config was not found. Check the base path (YARN: /proxy/application_…/).
- `CONN-SSO-REDIRECT` (error, panel (test result)): {host} sent a sign-in page instead of Flink data. Add the token or header your gateway expects.
- `CONN-TEST-PARTIAL` (warning, panel (step list)): Connected, but {failed}. Save as read-only?
- `CONN-WRITE-PROBE` (info, panel (step list)): Could not confirm write access without changing a job. Actions will ask at use.
- `CONN-LINK-EXPIRED` (warning, full-page state): The access link for {conn} expired. Paste a new one or set a refresh command.
- `CONN-PROXY` (error, panel (test result)): The proxy {proxy} refused the connection ({status}).
- `CONN-TLS-VERIFY-OFF` (error, banner (form) + badge on connection): Certificate checks are off for {conn}. Not allowed for Production connections.
- `API-401` (error, dialog): Sign in again to {conn}. The cluster rejected the token.
- `APP-CRASH-RECOVERED` (warning, dialog): Stream Lab closed unexpectedly. Your connections and tabs were restored.

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
- Signed installers build in CI (INST-01).
- Finish with a table: ID or code → test file → pass/fail, and a list of anything not done and why.
