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
  ['field', /\bfield\b|\binline\b|tooltip|button disabled/i],
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
  return [...new Set([...CATALOG[code].message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
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
  const message = entry.message.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = e.params[k];
    if (v === undefined) {
      if (DEV) throw new Error(`${e.code}: param {${k}} is not filled`);
      return '…';
    }
    return String(v);
  });
  // ponytail: naive sentence split on ". " — fine for the catalog's copy; revisit if a message uses "e.g. ".
  const m = /^(.+?[.?])\s+(.+)$/s.exec(message);
  const title = (m ? m[1]! : message).replace(/\.$/, '');
  return {
    code: e.code,
    severity: severityOf(entry.severity, e),
    placement: primaryPlacement(entry.placement),
    title,
    body: m ? m[2]! : '',
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

/** 401→API-401, 403→API-403, 404→API-404-JOB, 409→API-409, 429→API-RATE, 5xx→API-5XX. */
export function fromHttp(res: HttpLike, ctx: RequestCtx): AppError {
  if (res.status < 400) throw new Error(`fromHttp called with HTTP ${res.status}`);
  const code = HTTP[res.status] ?? 'API-5XX';
  // ponytail: other 4xx (400, 405…) land on API-5XX's copy until a catalog row exists for them.
  const params: Params = { thing: 'job', verb: 'answering', action: 'This action', ...ctxParams(ctx) };
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

/** Flink REST errors: `{errors: string[]}`; the root cause is the deepest "Caused by:" line. */
export function fromFlinkErrors(
  body: { errors?: string[] },
  ctx: { code: ErrorCode; params?: Params },
): AppError {
  const text = (body.errors ?? []).join('\n');
  const caused = [...text.matchAll(/^Caused by:\s*(.+)$/gm)].map((m) => m[1]!.trim());
  const first = text
    .split('\n')
    .map((l) => l.replace(/^<?Exception on server side:\s*/, '').trim())
    .find((l) => l && l !== '<' && l !== '>');
  const reason = (caused.at(-1) ?? first ?? 'unknown cause').replace(/\.$/, '');
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
    }),
    null,
    2,
  );
}
