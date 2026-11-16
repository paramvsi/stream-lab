import { describe, expect, it } from 'vitest';
import { fromTransport, TransportError, type FlinkHttp, type FlinkRequest, type TransportKind } from './http';
import { testConnection, type StepResult } from './testConnection';

const URL_ = 'https://flink.example.com:8081';
const target = { name: 'prod-eu', url: URL_, readOnly: false, hasGateway: true };
const ok = (body: unknown, extra: Partial<{ status: number; url: string; ct: string }> = {}) => ({
  status: extra.status ?? 200,
  headers: { 'content-type': extra.ct ?? 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  url: extra.url ?? `${URL_}/x`,
});
const CONFIG = { 'flink-version': '1.20.1', 'refresh-interval': 3000, features: { 'web-submit': true } };
const OVERVIEW = {
  taskmanagers: 2,
  'slots-total': 8,
  'slots-available': 3,
  'jobs-running': 4,
  'jobs-finished': 0,
  'jobs-cancelled': 1,
  'jobs-failed': 0,
};
/** A cluster answering per path; anything else is a 404. */
const cluster = (
  over: Record<string, ReturnType<typeof ok> | Error> = {},
): FlinkHttp & { calls: FlinkRequest[] } => {
  const calls: FlinkRequest[] = [];
  const base: Record<string, ReturnType<typeof ok> | Error> = {
    'GET /config': ok(CONFIG),
    'GET /overview': ok(OVERVIEW),
    'GET /v1/info': ok({ productName: 'Apache Flink', version: '1.20.1' }),
    'POST /v1/sessions': ok({ sessionHandle: 's-1' }),
    'DELETE /v1/sessions/s-1': ok({ status: 'CLOSED' }),
    ...over,
  };
  const f = (async (r: FlinkRequest) => {
    calls.push(r);
    const a = base[`${r.method} ${r.path}`] ?? ok('not found', { status: 404 });
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as FlinkHttp & { calls: FlinkRequest[] };
  f.calls = calls;
  return f;
};
async function run(http: FlinkHttp, t = target) {
  const steps: StepResult[] = [];
  const g = testConnection(http, t);
  for (;;) {
    const n = await g.next();
    if (n.done) return { steps, outcome: n.value };
    steps.push(n.value);
  }
}
const statuses = (s: StepResult[]) => s.map((x) => `${x.id}:${x.status}${x.error ? `:${x.error.code}` : ''}`);
const transport = (kind: TransportKind) =>
  new TransportError({ kind, host: 'flink.example.com:8081', port: 8081, timeoutS: 10 });

describe('CONN-05 test connection (FLINK_API.md, C04)', () => {
  it('all seven steps pass in order; the gateway session is opened and closed; write access is never probed', async () => {
    const http = cluster();
    const { steps, outcome } = await run(http);
    expect(statuses(steps)).toEqual([
      'resolve:pass',
      'connect:pass',
      'login:pass',
      'flink:pass',
      'overview:pass',
      'write:info:CONN-WRITE-PROBE',
      'gateway:pass',
    ]);
    expect(outcome.result).toBe('pass');
    expect(steps[4]!.detail).toBe('2 TaskManagers · 3 of 8 slots free · 4 running');
    expect(http.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /config',
      'GET /overview',
      'GET /v1/info',
      'POST /v1/sessions',
      'DELETE /v1/sessions/s-1',
    ]);
    expect(http.calls.some((c) => /stop|cancel|savepoints/.test(c.path) || c.method === 'PATCH')).toBe(false);
  });
  it('DNS fails step 1; anything else on the wire fails step 2; the rest is skipped', async () => {
    const dns = await run(cluster({ 'GET /config': transport('dns') }));
    expect(statuses(dns.steps).slice(0, 2)).toEqual(['resolve:fail:CONN-DNS', 'connect:skip']);
    expect(dns.outcome).toMatchObject({ result: 'fail' });
    const refused = await run(cluster({ 'GET /config': transport('refused') }));
    expect(statuses(refused.steps).slice(0, 3)).toEqual([
      'resolve:pass',
      'connect:fail:CONN-REFUSED',
      'login:skip',
    ]);
    expect(refused.steps).toHaveLength(7);
  });
  it.each([
    [ok('nope', { status: 401 }), 'login:fail:API-401'],
    [ok('<html><body>Sign in</body></html>', { ct: 'text/html' }), 'login:fail:CONN-SSO-REDIRECT'],
    [ok(CONFIG, { url: 'https://sso.example.com/login' }), 'login:fail:CONN-SSO-REDIRECT'],
    [ok('missing', { status: 404 }), 'login:fail:CONN-BASEPATH'],
    [ok({ hello: 'world' }), 'flink:fail:CONN-NOT-FLINK'],
  ])('step 3/4 answers: %# → %s', async (answer, expected) => {
    const { steps, outcome } = await run(cluster({ 'GET /config': answer }));
    expect(statuses(steps)).toContain(expected);
    expect(outcome.result).toBe('fail');
  });
  it('an old version is a warning (read-only, best effort), not a failure', async () => {
    const { steps, outcome } = await run(cluster({ 'GET /config': ok({ 'flink-version': '1.18.1' }) }));
    expect(statuses(steps)[3]).toBe('flink:warn:CONN-VERSION-OLD');
    expect(outcome.result).toBe('pass');
  });
  it('reads pass but the gateway fails: partial, "Save as read-only" (CONN-TEST-PARTIAL)', async () => {
    const { steps, outcome } = await run(cluster({ 'GET /v1/info': transport('refused') }));
    expect(statuses(steps)[6]).toBe('gateway:fail:CONN-REFUSED');
    expect(outcome).toMatchObject({ result: 'partial', error: { code: 'CONN-TEST-PARTIAL' } });
  });
  it('no gateway set: skipped; read-only connections say so instead of the probe notice', async () => {
    const { steps, outcome } = await run(cluster(), { ...target, hasGateway: false, readOnly: true });
    expect(statuses(steps).slice(5)).toEqual(['write:info', 'gateway:skip']);
    expect(outcome.result).toBe('pass');
  });
});

describe('fromTauriHttp: every transport kind has its catalog code', () => {
  it.each([
    ['dns', 'CONN-DNS'],
    ['refused', 'CONN-REFUSED'],
    ['timeout', 'CONN-TIMEOUT'],
    ['tls_untrusted', 'CONN-TLS-UNTRUSTED'],
    ['tls_other', 'CONN-TLS-UNTRUSTED'],
    ['tls_changed', 'CONN-CERT-CHANGED'],
    ['proxy', 'CONN-PROXY'],
    ['ssh_auth', 'CONN-SSH-AUTH'],
    ['ssh_host_key', 'CONN-SSH-HOSTKEY'],
    ['k8s', 'CONN-K8S-CONTEXT'],
    ['io', 'CONN-IO'],
  ] as const)('%s → %s', (kind, code) => {
    expect(fromTransport({ kind, host: 'h:1' }).code).toBe(code);
  });
});
