import { CATALOG, type ErrorCode } from './catalog';

export { CATALOG, type ErrorCode } from './catalog';
export type Severity = 'error' | 'warning' | 'info' | 'success';
export type Params = Record<string, string | number>;

export class AppError extends Error {
  http?: { method: string; url: string; status: number };
  /** Only for codes whose catalog severity lists choices (ALERT-FIRED: "warning|error (rule severity)"). */
  severity?: Severity;
  constructor(
    public code: ErrorCode,
    public params: Params = {},
    public override cause?: unknown,
    public detail?: unknown,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

/** The seven placements of ERRORS_AND_ALERTS.md §2. */
export const PLACEMENTS = ['field', 'badge', 'panel', 'banner', 'toast', 'dialog', 'page'] as const;
export type Placement = (typeof PLACEMENTS)[number];

// The catalog's placement column is prose ("banner (form) + badge on connection"); the primary is the first one named.
const PLACEMENT_WORDS: [Placement, RegExp][] = [
  ['field', /\bfield\b|\binline\b(?! banner)|tooltip|button disabled/i],
  ['badge', /badge/i],
  ['panel', /\bpanel\b|problems|alerts list/i],
  ['banner', /banner/i],
  ['toast', /toast/i],
  ['dialog', /dialog/i],
  ['page', /full-page/i],
];

export function primaryPlacement(raw: string): Placement {
  let best: [Placement, number] | null = null;
  for (const [p, re] of PLACEMENT_WORDS) {
    const i = raw.search(re);
    if (i >= 0 && (!best || i < best[1])) best = [p, i];
  }
  if (!best) throw new Error(`No known placement in "${raw}"`);
  return best[0];
}

export function paramsOf(code: ErrorCode): string[] {
  // A placeholder is words and spaces: the catalog has {root cause first line} (JOB-FAILED), {first line}.
  return [...new Set([...CATALOG[code].message.matchAll(/\{([\w ]+)\}/g)].map((m) => m[1]!))];
}

function severityOf(raw: string, e: AppError): Severity {
  const allowed = raw
    .split(/[|\s]/)
    .filter((x): x is Severity => ['error', 'warning', 'info', 'success'].includes(x));
  if (e.severity && allowed.includes(e.severity)) return e.severity;
  if (e.severity && DEV) throw new Error(`${e.code}: severity ${e.severity} is not one of ${raw}`);
  return allowed[0] ?? 'error';
}

export interface Presented {
  code: ErrorCode;
  severity: Severity;
  placement: Placement;
  /** First sentence, no final stop: dialog titles, full-page headings. */
  title: string;
  /** Everything after the first sentence (may be empty). */
  body: string;
  /** The whole message: banners, toasts, fields. */
  message: string;
  actions: readonly string[];
}

const DEV = import.meta.env?.DEV ?? true;

export function present(e: AppError): Presented {
  const entry = (CATALOG as Record<string, (typeof CATALOG)[ErrorCode] | undefined>)[e.code];
  if (!entry) {
    if (DEV) throw new Error(`${e.code} is not in the catalog (docs/ERROR_CATALOG.md)`);
    return present(new AppError('API-SHAPE', {}, e));
  }
  const fill = (tpl: string) =>
    tpl.replace(/\{([\w ]+)\}/g, (_, k: string) => {
      const v = e.params[k];
      if (v === undefined) {
        if (DEV) throw new Error(`${e.code}: param {${k}} is not filled`);
        return '…';
      }
      return String(v);
    });
  const message = fill(entry.message);
  // Split the template (not the filled text) so a param containing ". " stays in one piece.
  // ponytail: naive sentence split on ". " — fine for the catalog's copy; revisit if a message uses "e.g. ".
  const m = /^(.+?[.?])\s+(.+)$/s.exec(entry.message);
  const title = fill(m ? m[1]! : entry.message).replace(/\.$/, '');
  const body = m ? fill(m[2]!) : '';
  return {
    code: e.code,
    severity: severityOf(entry.severity, e),
    placement: primaryPlacement(entry.placement),
    title,
    body,
    message,
    actions: entry.actions,
  };
}

/* ---------- mappers ---------- */

export interface RequestCtx {
  method: string;
  url: string;
  /** Connection name, used as {conn}. */
  conn?: string;
  /** Extra params for the code's message ({verb}, {action}, {thing}, {job}, {state}, {timeout}…). */
  [param: string]: string | number | undefined;
}

function hostPort(url: string): { host: string; port: string | number } {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80) };
  } catch {
    return { host: url, port: '' };
  }
}

function ctxParams(ctx: RequestCtx): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined && k !== 'method' && k !== 'url') out[k] = v;
  return out;
}

export interface HttpLike {
  status: number;
  headers?: Record<string, string> | Headers;
}

const HTTP: Record<number, ErrorCode> = {
  401: 'API-401',
  403: 'API-403',
  404: 'API-404-JOB',
  409: 'API-409',
  429: 'API-RATE',
};

/** 401→API-401, 403→API-403, 404→API-404-JOB, 409→API-409, 429→API-RATE, other 4xx→API-4XX, 5xx→API-5XX. */
export function fromHttp(res: HttpLike, ctx: RequestCtx): AppError {
  if (res.status < 400) throw new Error(`fromHttp called with HTTP ${res.status}`);
  const code = HTTP[res.status] ?? (res.status >= 500 ? 'API-5XX' : 'API-4XX');
  // {thing} defaults to "job" for API-404-JOB; callers on other endpoints pass thing: 'TaskManager' etc.
  const params: Params = {
    thing: 'job',
    verb: 'answering',
    action: 'This action',
    status: res.status,
    ...ctxParams(ctx),
  };
  if (code === 'API-RATE') {
    const h = res.headers;
    const ra = h instanceof Headers ? h.get('retry-after') : h?.['retry-after'];
    params.s = Number(ra) > 0 ? Number(ra) : 30;
  }
  const e = new AppError(code, params, undefined, res);
  e.http = { method: ctx.method, url: ctx.url, status: res.status };
  return e;
}

export type TransportKind =
  | 'dns'
  | 'refused'
  | 'timeout'
  | 'tls_untrusted'
  | 'tls_changed'
  | 'tls_other'
  | 'proxy'
  | 'ssh_auth'
  | 'ssh_host_key'
  | 'k8s'
  | 'io';

const KIND: Record<TransportKind, ErrorCode> = {
  dns: 'CONN-DNS',
  refused: 'CONN-REFUSED',
  timeout: 'CONN-TIMEOUT',
  tls_untrusted: 'CONN-TLS-UNTRUSTED',
  tls_changed: 'CONN-CERT-CHANGED',
  tls_other: 'CONN-TLS-UNTRUSTED',
  proxy: 'CONN-PROXY',
  ssh_auth: 'CONN-SSH-AUTH',
  ssh_host_key: 'CONN-SSH-HOSTKEY',
  k8s: 'CONN-K8S-CONTEXT',
  io: 'CONN-LOST',
};

/** Maps the typed error kind from the Rust `flink_request` command (docs/FLINK_API.md) to CONN-*. */
export function fromTauriHttp(err: unknown, ctx: RequestCtx): AppError {
  const kind = (err as { kind?: string } | null)?.kind;
  const code = kind && kind in KIND ? KIND[kind as TransportKind] : 'CONN-LOST';
  const { host, port } = hostPort(ctx.url);
  // Only what the URL tells us; the rest ({user}, {svc}, {reason}…) comes from Rust's typed params or the caller.
  const fromRust = (err as { params?: Params } | null)?.params ?? {};
  const params: Params = { host, port, url: ctx.url, ...fromRust, ...ctxParams(ctx) };
  const e = new AppError(code, params, err);
  e.http = { method: ctx.method, url: ctx.url, status: 0 };
  return e;
}

const JAVA_CLASS = /^(?:[A-Za-z_$][\w$]*\.)*([A-Z][\w$]*(?:Exception|Error|Throwable))/;

/** Drop every leading `pkg.ClassName: ` wrapper; a bare exception keeps its simple class name. */
export function cleanCause(raw: string): string {
  let s = raw.trim();
  for (let m = JAVA_CLASS.exec(s); m; m = JAVA_CLASS.exec(s)) {
    const rest = s.slice(m[0].length);
    if (!/^\s*:/.test(rest)) return m[1]!; // "java.lang.NullPointerException" → "NullPointerException"
    s = rest.replace(/^\s*:\s*/, '');
  }
  return s.replace(/\.$/, '') || raw;
}

/** Flink REST errors: `{errors: string[]}`; the root cause is the deepest "Caused by:" line. */
export function fromFlinkErrors(
  body: { errors?: string[] },
  ctx: { code: ErrorCode; params?: Params },
): AppError {
  const text = (body.errors ?? []).join('\n');
  const rawLines = text.split('\n');
  // Only top-level "Caused by" (column 0): indented ones belong to Suppressed blocks, not the root cause chain.
  const caused = rawLines.filter((l) => l.startsWith('Caused by:')).map((l) => l.slice(10).trim());
  const lines = rawLines.map((l) => l.trim());
  // Without a "Caused by", the root cause is the first line of the server-side exception, not Flink's generic errors[0].
  const marker = lines.findIndex((l) => /Exception on server side:/.test(l));
  const afterMarker = marker >= 0 ? lines.slice(marker + 1).find((l) => l && l !== '>') : undefined;
  const first = lines.find((l) => l && l !== '<' && l !== '>');
  const raw = caused.at(-1) ?? afterMarker ?? first ?? 'unknown cause';
  // Rule: no raw exception text as the main message — drop the Java class name; the full text is in Copy details.
  // ponytail: whether {reason} should carry Flink text at all is open (MORNING.md D11).
  const reason = cleanCause(raw);
  return new AppError(ctx.code, { reason, ...ctx.params }, undefined, body);
}

/* ---------- Copy details ---------- */

const SECRET_KEY = /authorization|token|password|passphrase|secret|api[-_]?key|cookie/i;

function redact(v: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof v === 'string')
    return v
      .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, '$1 [redacted]')
      .replace(/(\/\/)[^/@\s]+@/g, '$1[redacted]@')
      .replace(/([?&][^=&\s]*(?:token|password|secret|key|sig)[^=&\s]*=)[^&\s"']+/gi, '$1[redacted]');
  if (Array.isArray(v)) return v.map((x) => redact(x));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x, k)]));
  return v;
}

function serializeCause(c: unknown): unknown {
  if (c instanceof Error) return { name: c.name, message: c.message, stack: c.stack };
  return c;
}

/** The JSON blob behind "Copy details" (§3 rule 6). Secrets are redacted. */
export function copyDetails(e: AppError, ctx: { appVersion: string; flinkVersion?: string }): string {
  let message: string;
  try {
    message = present(e).message;
  } catch {
    message = e.code;
  }
  return JSON.stringify(
    redact({
      code: e.code,
      message,
      params: e.params,
      http: e.http,
      flinkVersion: ctx.flinkVersion,
      appVersion: ctx.appVersion,
      time: new Date().toISOString(),
      detail: e.detail,
      cause: serializeCause(e.cause),
    }),
    null,
    2,
  );
}
