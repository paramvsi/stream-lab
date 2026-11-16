import { AppError } from '@sl/errors';

/**
 * The one way the desktop app reaches a cluster (FLINK_API.md "How the app reaches a cluster"): JS sends this to
 * the Rust command `flink_request`, which adds the base URL, base path, auth, headers and TLS. Tests pass a fake.
 */
export interface FlinkRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Send to the SQL Gateway address instead of the REST address. */
  gateway?: boolean;
}
export interface FlinkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The URL that answered (after redirects): a different host means an SSO page. */
  url: string;
}
export type FlinkHttp = (req: FlinkRequest) => Promise<FlinkResponse>;

/** The transport's typed failure kinds (Rust side). */
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
export interface TransportFailure {
  kind: TransportKind;
  host: string;
  port?: number;
  timeoutS?: number;
  reason?: string;
  proxy?: string;
  status?: number;
  user?: string;
  bastion?: string;
  svc?: string;
  ns?: string;
  ctx?: string;
}
/** What `flink_request` rejects with when no HTTP response came back. */
export class TransportError extends Error {
  constructor(readonly failure: TransportFailure) {
    super(`transport: ${failure.kind}`);
  }
}

/** fromTauriHttp: a transport failure as its catalog code (FLINK_API.md). */
export function fromTransport(f: TransportFailure, cause?: unknown): AppError {
  const host = f.host;
  switch (f.kind) {
    case 'dns':
      return new AppError('CONN-DNS', { host }, cause);
    case 'refused':
      return new AppError('CONN-REFUSED', { host, port: f.port ?? '' }, cause);
    case 'timeout':
      return new AppError('CONN-TIMEOUT', { host, timeout: f.timeoutS ?? '' }, cause);
    case 'tls_untrusted':
    case 'tls_other':
      return new AppError('CONN-TLS-UNTRUSTED', { host, reason: f.reason ?? 'unknown issuer' }, cause);
    case 'tls_changed':
      return new AppError('CONN-CERT-CHANGED', { host }, cause);
    case 'proxy':
      return new AppError('CONN-PROXY', { proxy: f.proxy ?? '', status: f.status ?? '' }, cause);
    case 'ssh_auth':
      return new AppError('CONN-SSH-AUTH', { user: f.user ?? '', bastion: f.bastion ?? host }, cause);
    case 'ssh_host_key':
      return new AppError('CONN-SSH-HOSTKEY', { bastion: f.bastion ?? host }, cause);
    case 'k8s':
      return new AppError('CONN-K8S-CONTEXT', { svc: f.svc ?? '', ns: f.ns ?? '', ctx: f.ctx ?? '' }, cause);
    case 'io':
      return new AppError('CONN-IO', { host, reason: f.reason ?? 'connection reset' }, cause);
  }
}
