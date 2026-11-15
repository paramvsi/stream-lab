# Errors and alerts: the system

Boards: `X00` (desktop) and `WX00` (web) define this system; every `X…`/`WX…` board shows one case. The full list of cases is `ERROR_CATALOG.md`.

## 1. Severity (four, no more)

| Severity | Meaning | Icon | Colours (bg / accent) | Announce |
|---|---|---|---|---|
| error | Failed or blocked; user must act | alert-triangle | `danger-50` / `danger-600` | `role=alert` (assertive) |
| warning | Works now but may go wrong or cost something | alert-triangle | `orange-50` / `orange-700` | `role=status` (polite) |
| info | Useful context, no action needed | info | `rose-50` or `subtle` / `rose-700` | `role=status` |
| success | Action finished as asked | check | `success-50` / `success-600` | `role=status` |

Never colour alone: icon + words always.

## 2. Placement (pick exactly one primary)

| Placement | Use when | Component | Stays |
|---|---|---|---|
| **Field / inline** | One input, one expression, one SQL token | `<FieldError>`, CodeMirror diagnostic | until fixed |
| **Object badge** | A node, job, operator or connection has a problem | `<StatusBadge>` + ring on the object; hover = reason | until fixed |
| **Panel list** | Several problems at once | `<ProblemsPanel>`; rows link to source (click → select node / move cursor) | until fixed |
| **Banner** | Whole page or connection affected | `<Banner>` under header, max one action group | until resolved (info banners can be dismissed) |
| **Toast** | Feedback on an action just taken | `<Toast>` bottom-left; success/info 4 s, warning 6 s, error 8 s; pause on hover/focus; max 3 stacked; one action | auto |
| **Dialog** | Destructive, blocking, or needs a decision | `<Dialog>` title says the outcome, buttons say the verb | until a choice |
| **Full-page state** | Nothing can load | `<EmptyState tone>` icon, cause, likely reason, 1–3 actions | until retry ok |

Object badges and problem rows *may* accompany a field error (same code, different view of the same issue). Toast + banner for the same code: never.

## 3. Message rules
1. What happened → why (if known) → what to do. Max ~2 sentences.
2. Name the exact thing (field, line, job, node, host).
3. No blame, no "oops", no exclamation marks, no codes in the sentence. The code shows in "Copy details" and in small mono text in tooltips.
4. Keep the user's work. Errors never clear a form, an editor or the canvas.
5. Disabled actions explain why (tooltip + `aria-describedby`), e.g. Run: "Fix 2 errors to run".
6. Technical detail (stack, HTTP body, Flink root cause) lives behind **Copy details**, which copies a JSON blob: `{code, message, params, http:{method,url,status}, flinkVersion, appVersion, time}`. Redact tokens, passwords and `Authorization` headers.

## 4. Implementation contract

```ts
// packages/errors
export class AppError extends Error {
  constructor(public code: ErrorCode, public params: Record<string, string | number> = {}, public cause?: unknown, public detail?: unknown) {}
}
export function present(e: AppError): { severity; placement; title; message; actions } // from CATALOG + params
export function fromHttp(res: Response, ctx: RequestCtx): AppError        // 401→API-401, 403→API-403, 404, 409, 429, other 4xx→API-4XX, 5xx
export function fromTauriHttp(err: unknown, ctx): AppError                 // dns/refused/timeout/tls → CONN-*
export function fromFlinkErrors(body: { errors: string[] }, ctx): AppError // parses Flink "errors" array, root cause first line
export function fromSqlGateway(body, statement): Diagnostic[] | AppError   // see SQL_EDITOR.md
```
- `present()` throws in dev if a code is missing from the catalog or a `{param}` is unfilled. A unit test walks every catalog entry.
- One `<ErrorBoundary>` per route and per panel (job page tabs, SQL results, each dashboard widget) so one broken widget does not blank the page (`API-SHAPE`).
- Toasts go through `useToast()`; banners through `<PageBanners>` slot (dedupe by code + object id).
- Polling errors: count consecutive failures per query; 1 → silent retry, 2 → stale badges, 3 → banner (`CONN-LOST` / `API-TIMEOUT`). Back-off 2 s, 4 s, 8 s, 16 s, 30 s cap. Recovering clears the banner and shows a success toast "Back in contact with {conn}" once.
- Non-idempotent requests (stop, savepoint, cancel, run JAR, SQL statement) are **never** auto-retried. On timeout, query state before offering "Try again".

## 5. Alerts (desktop rules engine)
- Rules evaluate on each poll, per connection, in the background (keep polling while app is open; tray when window closed — setting).
- Fire once per breach; re-arm after it clears for 2 consecutive polls. Mute per rule/job (1 h, 8 h, until resolved).
- Deliver: OS notification (click → deep link to the job), alerts list, and object badge. No sound by default.
- Each fired alert stores: rule, value, threshold, time, connection, job, link.

## 6. Checklist for any new screen
- [ ] Loading (skeleton matching layout, never a lone spinner >300 ms)
- [ ] Empty (what this is + how to fill it)
- [ ] Error (catalog code, correct placement)
- [ ] Partial / stale data (if it polls)
- [ ] Offline (desktop) / storage blocked (web)
- [ ] Read-only (desktop, if it has actions)
