import { AppError } from '@sl/errors';
import { z } from 'zod';

/**
 * A saved connection (CONN-01..04, 08, 09). Secrets are never part of it: passwords, tokens, the mTLS key's
 * passphrase and secret header values live in the OS keychain only (CLAUDE.md), keyed by the connection id.
 */
const Auth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('basic'), user: z.string() }),
  z.object({ type: z.literal('bearer') }),
  /** A command that prints a token; re-run when a 401 arrives. */
  z.object({ type: z.literal('token-command'), command: z.string() }),
  z.object({ type: z.literal('mtls'), cert: z.string(), key: z.string(), ca: z.string().optional() }),
]);
const Header = z.object({
  name: z.string(),
  /** Absent when secret: the value is in the keychain. */
  value: z.string().optional(),
  secret: z.boolean(),
});
export const ConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  url: z.string(),
  kind: z.enum(['standalone', 'kubernetes', 'yarn', 'gateway', 'ververica', 'amazon']),
  env: z.enum(['prod', 'staging', 'dev', 'none']),
  readOnly: z.boolean(),
  basePath: z.string(),
  auth: Auth,
  headers: z.array(Header),
  transport: z.discriminatedUnion('type', [
    z.object({ type: z.literal('direct') }),
    z.object({ type: z.literal('proxy'), url: z.string() }),
  ]),
  timeoutMs: z.number().int().positive(),
  pollMs: z.number().int().positive(),
  /** A separate SQL Gateway address (CONN-04); sameLogin: use the REST login, else its own (secrets in the keychain). */
  gateway: z.object({ url: z.string(), sameLogin: z.boolean(), auth: Auth.optional() }).optional(),
  /** Amazon Managed Service for Apache Flink: a command that prints a fresh pre-signed URL (FLINK_API.md). */
  refreshCommand: z.string().optional(),
});
export type Connection = z.infer<typeof ConnectionSchema>;
export type ConnectionField =
  'name' | 'url' | 'user' | 'command' | 'cert' | 'key' | 'proxy' | 'headers' | 'gateway' | 'gatewayLogin';

const FIELD_LABEL: Record<ConnectionField, string> = {
  name: 'Name',
  url: 'Address',
  user: 'User',
  command: 'Token command',
  cert: 'Client certificate',
  key: 'Client key',
  proxy: 'Proxy address',
  headers: 'Headers',
  gateway: 'SQL Gateway address',
  gatewayLogin: 'SQL Gateway login',
};
const required = (f: ConnectionField) => new AppError('CONN-REQUIRED', { field: FIELD_LABEL[f] });
/** An address's problem: not http(s) with a host (CONN-URL-INVALID), or a user and password in it (CONN-URL-SECRET). */
function urlError(u: string): AppError | null {
  let x: URL;
  try {
    x = new URL(u);
  } catch {
    return new AppError('CONN-URL-INVALID');
  }
  if ((x.protocol !== 'http:' && x.protocol !== 'https:') || !x.hostname)
    return new AppError('CONN-URL-INVALID');
  if (x.username || x.password) return new AppError('CONN-URL-SECRET');
  return null;
}
/** Headers that carry credentials: never stored or exported as plain values. */
const SECRET_HEADERS = new Set(['proxy-authorization', 'cookie', 'x-api-key', 'api-key']);
const isSecretHeader = (h: { name: string; secret: boolean }) =>
  h.secret || SECRET_HEADERS.has(h.name.trim().toLowerCase());

/**
 * CONN-02: every field's problem, on blur (one field) and on save (all). `taken`: the other connections' names.
 * CONN-MTLS-FILE is raised when the file is read (Rust side), not here.
 */
export function validateConnection(
  c: Connection,
  taken: string[],
): Partial<Record<ConnectionField, AppError>> {
  const out: Partial<Record<ConnectionField, AppError>> = {};
  const name = c.name.trim();
  if (!name) out.name = required('name');
  else if (taken.some((t) => t.trim().toLowerCase() === name.toLowerCase()))
    out.name = new AppError('CONN-NAME-TAKEN', { name });
  if (!c.url.trim()) out.url = required('url');
  else {
    const e = urlError(c.url.trim());
    if (e) out.url = e;
  }
  if (c.auth.type === 'basic' && !c.auth.user.trim()) out.user = required('user');
  if (c.auth.type === 'token-command' && !c.auth.command.trim()) out.command = required('command');
  if (c.auth.type === 'mtls') {
    if (!c.auth.cert.trim()) out.cert = required('cert');
    if (!c.auth.key.trim()) out.key = required('key');
  }
  if (c.transport.type === 'proxy') {
    if (!c.transport.url.trim()) out.proxy = required('proxy');
    else {
      const e = urlError(c.transport.url.trim());
      if (e) out.proxy = e;
    }
  }
  // Authorization belongs to the Login section: kept in the keychain and redacted (CONN-HEADER-AUTH).
  if (c.headers.some((h) => h.name.trim().toLowerCase() === 'authorization'))
    out.headers = new AppError('CONN-HEADER-AUTH');
  else if (c.headers.some((h) => !h.name.trim()))
    out.headers = new AppError('CONN-REQUIRED', { field: 'Header name' });
  if (c.gateway && c.gateway.url.trim()) {
    const e = urlError(c.gateway.url.trim());
    if (e) out.gateway = e;
  }
  if (c.gateway && !c.gateway.sameLogin && !c.gateway.auth) out.gatewayLogin = required('gatewayLogin');
  return out;
}

/** CONN-08: the connections file. Secret header values are left out; secrets never leave the keychain. */
export const EXPORT_FORMAT = 'streamlab.connections';
export function exportConnections(cs: Connection[]): string {
  const clean = cs.map((c) => ({
    ...c,
    // Credential headers (Cookie, Proxy-Authorization…) count as secret even when not marked.
    headers: c.headers.map((h) => (isSecretHeader(h) ? { name: h.name, secret: true } : h)),
  }));
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, connections: clean }, null, 2);
}

const newId = () => `c_${crypto.randomUUID()}`;

const FileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  connections: z.array(ConnectionSchema),
});

/** The line of a character offset (1-based). */
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/**
 * CONN-08 import: the file's connections, or CONN-IMPORT-INVALID with the line and the reason (nothing is
 * imported). `duplicates`: names that already exist (the caller asks skip / replace / keep both: CONN-IMPORT-DUP).
 */
export function importConnections(
  file: string,
  text: string,
  existing: string[],
): { connections: Connection[]; duplicates: string[]; dupError: AppError | null } | { error: AppError } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // A position when the parser gives one; a file that ends too early: its last line.
    const m = /position (\d+)/.exec(String(e));
    const line = m ? lineAt(text, Number(m[1])) : text.split('\n').length;
    return { error: new AppError('CONN-IMPORT-INVALID', { file, line, reason: 'not valid JSON' }, e) };
  }
  const r = FileSchema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    const path = issue.path.join('.');
    // The line of the connection the problem is in (its "id"), else the top of the file.
    const i = issue.path[0] === 'connections' ? Number(issue.path[1]) : -1;
    const conns =
      data && typeof data === 'object'
        ? (data as { connections?: { id?: unknown }[] }).connections
        : undefined;
    const id = i >= 0 && Array.isArray(conns) ? conns[i]?.id : undefined;
    // The "id" key with that value, not the first place the same text appears (it may be a name).
    const m =
      typeof id === 'string'
        ? new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(text)
        : null;
    const at = m ? m.index : -1;
    return {
      error: new AppError('CONN-IMPORT-INVALID', {
        file,
        line: at >= 0 ? lineAt(text, at) : 1,
        reason: `${path || 'file'}: ${issue.message}`,
      }),
    };
  }
  // Names already here, or twice in the file (case ignored, as CONN-NAME-TAKEN does).
  const have = new Set(existing.map((n) => n.trim().toLowerCase()));
  const duplicates: string[] = [];
  for (const c of r.data.connections) {
    const k = c.name.trim().toLowerCase();
    if (have.has(k)) duplicates.push(c.name);
    have.add(k);
  }
  // Fresh ids: secrets are keyed by id, and a file's ids may match connections here or each other.
  const connections = r.data.connections.map((c) => ({ ...c, id: newId() }));
  return {
    connections,
    duplicates,
    dupError: duplicates.length ? new AppError('CONN-IMPORT-DUP', { n: duplicates.length }) : null,
  };
}
