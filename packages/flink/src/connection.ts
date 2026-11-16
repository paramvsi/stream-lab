import { AppError, present } from '@sl/errors';
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
  /** CONN-09: the tag's colour (board D02 swatches); the environment's own when absent. */
  color: z.enum(['red', 'orange', 'green', 'rose', 'grey']).optional(),
  readOnly: z.boolean(),
  basePath: z.string(),
  auth: Auth,
  headers: z.array(Header),
  transport: z.discriminatedUnion('type', [
    z.object({ type: z.literal('direct') }),
    /** user: the proxy's own login (its password is in the keychain); never inside the url. */
    z.object({ type: z.literal('proxy'), url: z.string(), user: z.string().optional() }),
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
/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Headers that carry credentials: their values go to the keychain even when not marked secret. */
const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);
const isSecretHeader = (h: { name: string; secret: boolean }) =>
  h.secret || SECRET_HEADERS.has(h.name.trim().toLowerCase());

/** The keychain entry for one secret of a connection: the cluster login, the gateway's, the proxy's, a header's. */
export const secretKey = (connId: string, part: 'login' | 'gateway' | 'proxy' | `header:${string}`) =>
  `streamlab/${connId}/${part}`;

/** An address without a user and password in it (they are never stored). */
/**
 * Only the user and password are cut; the rest stays as written (no added "/", case or port). Up to the LAST "@"
 * before the path (a password may contain "@"); then the URL parser confirms no login is left, and clears it
 * itself for anything the pattern missed (leading spaces, "http:u:p@host"…).
 */
function withoutUserinfo(u: string): string {
  // "\\" ends the host too (the URL parser reads it as "/" for http and https).
  const cut = u.replace(/^(\s*[a-z][a-z0-9+.-]*:\/\/)[^/?#\\]*@/i, '$1');
  let before: URL;
  try {
    before = new URL(u);
  } catch {
    // Not an address the parser reads: still never keep what looks like a login (to the last "@", "\\" included).
    return u.replace(/^(\s*[a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
  }
  try {
    const after = new URL(cut);
    // The cut kept the same host and left no login: keep it as written.
    if (after.host === before.host && !after.username && !after.password) return cut;
  } catch {
    // fall through: let the parser clear it
  }
  before.username = '';
  before.password = '';
  return before.toString();
}

/**
 * What may be stored or written to a file, and what goes to the keychain instead: header values that are
 * credentials (marked or not), keyed by secretKey(). Addresses lose any user and password. Used on save and export.
 */
export function splitSecrets(c: Connection): {
  connection: Connection;
  secrets: { key: string; value: string }[];
} {
  const secrets: { key: string; value: string }[] = [];
  const headers = c.headers.map((h) => {
    if (!isSecretHeader(h)) return h;
    if (h.value)
      // an empty value is no secret to keep
      secrets.push({ key: secretKey(c.id, `header:${h.name.trim().toLowerCase()}`), value: h.value });
    return { name: h.name.trim(), secret: true };
  });
  const connection: Connection = {
    ...c,
    url: withoutUserinfo(c.url),
    headers,
    transport:
      c.transport.type === 'proxy' ? { ...c.transport, url: withoutUserinfo(c.transport.url) } : c.transport,
    ...(c.gateway ? { gateway: { ...c.gateway, url: withoutUserinfo(c.gateway.url) } } : {}),
  };
  return { connection, secrets };
}

/** A login's own fields (the cluster's, or the SQL Gateway's when it has its own). */
function loginErrors(a: Connection['auth']): Partial<Record<'user' | 'command' | 'cert' | 'key', AppError>> {
  const out: Partial<Record<'user' | 'command' | 'cert' | 'key', AppError>> = {};
  if (a.type === 'basic' && !a.user.trim()) out.user = required('user');
  if (a.type === 'token-command' && !a.command.trim()) out.command = required('command');
  if (a.type === 'mtls') {
    if (!a.cert.trim()) out.cert = required('cert');
    if (!a.key.trim()) out.key = required('key');
  }
  return out;
}

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
  Object.assign(out, loginErrors(c.auth));
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
  else {
    // A header name is an HTTP token; one name once (secrets are keyed by name, and a second value would be lost).
    const seen = new Set<string>();
    for (const h of c.headers) {
      const n = h.name.trim();
      if (!HEADER_NAME.test(n)) {
        out.headers = new AppError('CONN-HEADER-INVALID', {
          // Invisible and direction-changing characters shown as \uXXXX; the rest as typed.
          name: n.replace(
            // eslint-disable-next-line no-control-regex -- control characters are exactly what is matched
            /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff\u{e0000}-\u{e007f}]/gu,
            (ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`,
          ),
          reason: 'has characters a header name can not have',
        });
        break;
      }
      if (seen.has(n.toLowerCase())) {
        out.headers = new AppError('CONN-HEADER-INVALID', { name: n, reason: 'is set twice' });
        break;
      }
      seen.add(n.toLowerCase());
    }
  }
  // A SQL Gateway counts only when it has an address; its own login must be complete.
  if (c.gateway && c.gateway.url.trim()) {
    const e = urlError(c.gateway.url.trim());
    if (e) out.gateway = e;
    // Its own login (not the cluster's): it must be there and complete.
    if (!c.gateway.sameLogin && (!c.gateway.auth || Object.keys(loginErrors(c.gateway.auth)).length))
      out.gatewayLogin = required('gatewayLogin');
  }
  return out;
}

/** CONN-08: the connections file. Secret header values are left out; secrets never leave the keychain. */
export const EXPORT_FORMAT = 'streamlab.connections';
export function exportConnections(cs: Connection[]): string {
  // An Authorization header (from before CONN-HEADER-AUTH) is left out: import would refuse the whole file for it.
  const clean = cs.map((c) => {
    // Headers as import will check them (connections saved before a rule existed still export something that
    // imports): names trimmed; Authorization, names that are not HTTP tokens and repeats (first kept) left out.
    const x = splitSecrets(c).connection;
    const seen = new Set<string>();
    const headers = x.headers
      .map((h) => ({ ...h, name: h.name.trim() }))
      .filter((h) => {
        const k = h.name.toLowerCase();
        if (k === 'authorization' || !HEADER_NAME.test(h.name) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    return { ...x, headers };
  });
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

/** The line of the n-th connection whose "id" is `id` (ids may repeat in a file); 1 when it can not be found. */
function lineOfId(text: string, id: unknown, nth: number): number {
  if (typeof id !== 'string') return 1;
  // Every "id": "…" in the text, decoded (an id may be written with JSON escapes), then the n-th equal one.
  const hits = [...text.matchAll(/"id"\s*:\s*("(?:[^"\\]|\\.)*")/g)].filter((m) => {
    try {
      return JSON.parse(m[1]!) === id;
    } catch {
      return false;
    }
  });
  const hit = hits[nth];
  return hit?.index !== undefined ? lineAt(text, hit.index) : 1;
}

export interface ImportDuplicate {
  /** The connection in the file (index into `connections`). */
  index: number;
  /** The connection here with the same name: "Replace" keeps its id (and so its keychain entries). */
  existingId: string;
}

/**
 * CONN-08 import: the file's connections, or CONN-IMPORT-INVALID with the line and the reason (nothing is
 * imported). Each connection is checked as the form checks it (no password in an address, no Authorization
 * header…), and a name may appear only once in a file. Imported connections get fresh ids; `duplicates` pairs each
 * one whose name exists here with that connection, for skip / replace / keep both (CONN-IMPORT-DUP).
 */
export function importConnections(
  file: string,
  text: string,
  existing: { id: string; name: string }[],
):
  | { connections: Connection[]; duplicates: ImportDuplicate[]; dupError: AppError | null }
  | { error: AppError } {
  const invalid = (line: number, reason: string, cause?: unknown) => ({
    error: new AppError('CONN-IMPORT-INVALID', { file, line, reason }, cause),
  });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // A position when the parser gives one; a file that ends too early: its last line.
    const m = /position (\d+)/.exec(String(e));
    return invalid(m ? lineAt(text, Number(m[1])) : text.split('\n').length, 'not valid JSON', e);
  }
  const rawConns =
    data && typeof data === 'object' ? (data as { connections?: { id?: unknown }[] }).connections : undefined;
  const lineOf = (i: number) => {
    if (!Array.isArray(rawConns)) return 1;
    const id = rawConns[i]?.id;
    const nth = rawConns.slice(0, i).filter((c) => c?.id === id).length;
    return lineOfId(text, id, nth);
  };
  const r = FileSchema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0]!;
    const i = issue.path[0] === 'connections' ? Number(issue.path[1]) : -1;
    return invalid(i >= 0 ? lineOf(i) : 1, `${issue.path.join('.') || 'file'}: ${issue.message}`);
  }
  const seen = new Set<string>();
  for (const [i, c] of r.data.connections.entries()) {
    const problems = Object.entries(validateConnection(c, []));
    if (problems.length) {
      const [field, e] = problems[0]!;
      return invalid(
        lineOf(i),
        `${c.name || 'a connection'}, ${FIELD_LABEL[field as ConnectionField]}: ${present(e!).message.replace(/\.$/, '')}`,
      );
    }
    const k = c.name.trim().toLowerCase();
    if (seen.has(k)) return invalid(lineOf(i), `the name "${c.name.trim()}" appears twice`);
    seen.add(k);
  }
  const here = new Map<string, string>();
  for (const x of existing)
    if (!here.has(x.name.trim().toLowerCase())) here.set(x.name.trim().toLowerCase(), x.id);
  const duplicates: ImportDuplicate[] = [];
  const connections = r.data.connections.map((c, index) => {
    const existingId = here.get(c.name.trim().toLowerCase());
    if (existingId) duplicates.push({ index, existingId });
    // Fresh ids: secrets are keyed by id, and a file's ids may match connections here or each other. Secret values
    // in a file (hand-written: export never writes them) are not taken: secrets only come from the keychain.
    return {
      ...c,
      id: newId(),
      headers: c.headers.map((h) => (isSecretHeader(h) ? { name: h.name, secret: true } : h)),
    };
  });
  return {
    connections,
    duplicates,
    dupError: duplicates.length ? new AppError('CONN-IMPORT-DUP', { n: duplicates.length }) : null,
  };
}
