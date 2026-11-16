import { AppError } from '@sl/errors';
import type { ZodType } from 'zod';
import { READABLE } from './capabilities';
import { ConfigSchema, versionSupported, type FlinkConfig } from './endpoints/config';
import { GatewayInfoSchema, OpenSessionSchema } from './endpoints/gateway';
import { OverviewSchema } from './endpoints/overview';
import {
  fromTransport,
  httpStatusError,
  TransportError,
  type FlinkHttp,
  type FlinkRequest,
  type FlinkResponse,
} from './http';

/**
 * CONN-05 Test connection (FLINK_API.md, board C04): seven steps in order, each yielded as it finishes so the
 * form shows them live. Steps after a failed read step are skipped. Never calls stop or cancel (step 6).
 */
export type StepId = 'resolve' | 'connect' | 'login' | 'flink' | 'overview' | 'write' | 'gateway';
export const STEPS: { id: StepId; label: string }[] = [
  { id: 'resolve', label: 'Resolve the host' },
  { id: 'connect', label: 'Connect (TCP / TLS)' },
  { id: 'login', label: 'Sign in' },
  { id: 'flink', label: 'This is Flink' },
  { id: 'overview', label: 'Read the overview' },
  { id: 'write', label: 'Write access' },
  { id: 'gateway', label: 'SQL Gateway' },
];
export interface StepResult {
  id: StepId;
  status: 'pass' | 'warn' | 'info' | 'fail' | 'skip';
  error?: AppError;
  detail?: string;
}
export interface TestTarget {
  /** The connection's name ({conn}) and REST address ({url}, {host}). */
  name: string;
  url: string;
  readOnly: boolean;
  hasGateway: boolean;
}
export type TestOutcome =
  | { result: 'pass'; config: FlinkConfig }
  | { result: 'partial'; config: FlinkConfig; error: AppError }
  | { result: 'fail'; error: AppError };

class StepFailure extends Error {
  constructor(
    readonly at: StepId,
    readonly error: AppError,
  ) {
    super(error.code);
  }
}

export async function* testConnection(
  http: FlinkHttp,
  t: TestTarget,
): AsyncGenerator<StepResult, TestOutcome> {
  // An address that does not parse fails the first step (the form validates it first: CONN-URL-INVALID).
  let host: string;
  try {
    const u = new URL(t.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('not http');
    host = u.hostname.replace(/\.$/, '');
  } catch {
    const error = new AppError('CONN-URL-INVALID');
    yield { id: 'resolve', status: 'fail', error };
    for (const s of STEPS.slice(1)) yield { id: s.id, status: 'skip' };
    return { result: 'fail', error };
  }
  /** The host that answered (no port: a TLS terminator or a tunnel may change it); unknown: the same. */
  const answeredBy = (u: string) => {
    try {
      return new URL(u, t.url).hostname.replace(/\.$/, ''); // a trailing dot is the same host
    } catch {
      return host;
    }
  };
  const send = async (at: StepId, req: FlinkRequest): Promise<FlinkResponse> => {
    try {
      return await http(req);
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      throw new StepFailure(at, fromTransport(e.failure, e));
    }
  };
  const json = <T>(at: StepId, r: FlinkResponse, schema: ZodType<T>, bad: () => AppError): T => {
    try {
      const v = schema.safeParse(JSON.parse(r.body));
      if (v.success) return v.data;
    } catch {
      // not JSON: same answer as a wrong shape
    }
    throw new StepFailure(at, bad());
  };
  const statusError = (r: FlinkResponse, verb: string) => httpStatusError(r, t.name, verb);
  const skipFrom = function* (i: number) {
    for (const s of STEPS.slice(i)) yield { id: s.id, status: 'skip' as const };
  };

  // 1–4: one GET /config. A transport failure says which of the first two steps failed.
  let config: FlinkConfig;
  try {
    let r: FlinkResponse;
    try {
      r = await http({ method: 'GET', path: '/config' });
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      throw new StepFailure(e.failure.kind === 'dns' ? 'resolve' : 'connect', fromTransport(e.failure, e));
    }
    yield { id: 'resolve', status: 'pass' };
    yield { id: 'connect', status: 'pass' };
    const html = /text\/html/i.test(r.headers['content-type'] ?? '') || r.body.trimStart().startsWith('<');
    // A sign-in page: an answer from another host, an HTML page, or a redirect to another host (FLINK_API.md).
    const elsewhere = answeredBy(r.url) !== host;
    const redirect = r.status >= 300 && r.status < 400;
    const location = Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'location')?.[1] ?? '';
    const away = redirect && answeredBy(location) !== host;
    if (elsewhere || away || (r.status < 300 && html))
      throw new StepFailure('login', new AppError('CONN-SSO-REDIRECT', { host }));
    if (redirect) throw new StepFailure('login', statusError(r, 'reading /config'));
    if (r.status === 404) throw new StepFailure('login', new AppError('CONN-BASEPATH', { url: t.url }));
    if (r.status >= 400) throw new StepFailure('login', statusError(r, 'reading /config'));
    yield { id: 'login', status: 'pass' };
    config = json('flink', r, ConfigSchema, () => new AppError('CONN-NOT-FLINK', { url: t.url }));
    const version = config['flink-version'];
    if (versionSupported(version)) yield { id: 'flink', status: 'pass', detail: `Flink ${version}` };
    // A build without a version ("<unknown>"): Flink, but nothing to adapt the UI to.
    else if (!READABLE.test(version))
      yield { id: 'flink', status: 'warn', detail: 'Flink (it does not report its version)' };
    else
      yield {
        id: 'flink',
        status: 'warn',
        detail: `Flink ${version}`,
        error: new AppError('CONN-VERSION-OLD', { version }),
      };
    const o = await send('overview', { method: 'GET', path: '/overview' });
    if (o.status >= 400) throw new StepFailure('overview', statusError(o, 'reading the overview'));
    const ov = json('overview', o, OverviewSchema, () => new AppError('API-SHAPE'));
    yield {
      id: 'overview',
      status: 'pass',
      detail: `${ov.taskmanagers} TaskManagers · ${ov['slots-available']} of ${ov['slots-total']} slots free · ${ov['jobs-running']} running`,
    };
  } catch (e) {
    if (!(e instanceof StepFailure)) throw e;
    const i = STEPS.findIndex((s) => s.id === e.at);
    // Steps before the failure passed (a transport failure at "connect" means the host did resolve); this one
    // failed; the rest are skipped.
    if (e.at === 'connect') yield { id: 'resolve', status: 'pass' };
    yield { id: e.at, status: 'fail', error: e.error };
    yield* skipFrom(i + 1);
    return { result: 'fail', error: e.error };
  }

  // 6: no safe probe exists; never stop or cancel a job to find out.
  yield t.readOnly
    ? { id: 'write', status: 'info', detail: 'This connection is marked read-only.' }
    : { id: 'write', status: 'info', error: new AppError('CONN-WRITE-PROBE') };

  // 7: the SQL Gateway, if one is set: info, then open a session and close it.
  if (!t.hasGateway) {
    yield { id: 'gateway', status: 'skip', detail: 'No SQL Gateway set.' };
    return { result: 'pass', config };
  }
  try {
    const info = await send('gateway', { method: 'GET', path: '/v1/info', gateway: true });
    if (info.status >= 400)
      throw new StepFailure('gateway', statusError(info, 'reading the SQL Gateway info'));
    const gi = json('gateway', info, GatewayInfoSchema, () => new AppError('API-SHAPE'));
    const open = await send('gateway', {
      method: 'POST',
      path: '/v1/sessions',
      body: { properties: {} },
      gateway: true,
    });
    if (open.status >= 400) throw new StepFailure('gateway', statusError(open, 'opening a SQL session'));
    const { sessionHandle } = json('gateway', open, OpenSessionSchema, () => new AppError('API-SHAPE'));
    // The test session is closed whatever happens; a close that fails is said (it lingers until the gateway's
    // idle timeout) but does not fail a gateway that answered.
    const closed = await http({
      method: 'DELETE',
      path: `/v1/sessions/${encodeURIComponent(sessionHandle)}`,
      gateway: true,
    }).then(
      (c) => c.status < 400,
      () => false,
    );
    const what = `${gi.productName} ${gi.version}`;
    yield closed
      ? { id: 'gateway', status: 'pass', detail: what }
      : {
          id: 'gateway',
          status: 'warn',
          detail: `${what}; the test session did not close (it expires on its own)`,
        };
    return { result: 'pass', config };
  } catch (e) {
    if (!(e instanceof StepFailure)) throw e;
    yield { id: 'gateway', status: 'fail', error: e.error };
    // The reads passed: CONN-TEST-PARTIAL offers "Save as read-only".
    return {
      result: 'partial',
      config,
      error: new AppError('CONN-TEST-PARTIAL', { failed: 'the SQL Gateway check failed' }),
    };
  }
}
