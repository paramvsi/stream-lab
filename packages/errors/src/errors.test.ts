import { describe, expect, it } from 'vitest';
import { CATALOG, type ErrorCode } from './catalog';
import {
  AppError,
  PLACEMENTS,
  copyDetails,
  fromFlinkErrors,
  fromHttp,
  fromTauriHttp,
  paramsOf,
  present,
  primaryPlacement,
} from './index';

const codes = Object.keys(CATALOG) as ErrorCode[];
const sample = (code: ErrorCode) => Object.fromEntries(paramsOf(code).map((p) => [p, `<${p}>`]));

describe('ERR · catalog', () => {
  it('has 149 codes, each keyed by its own code', () => {
    expect(codes).toHaveLength(149);
    for (const c of codes) expect(CATALOG[c].code).toBe(c);
  });

  it.each(codes)('%s renders through present() with sample params', (code) => {
    const p = present(new AppError(code, sample(code)));
    expect(p.message).not.toMatch(/\{\w+\}/);
    expect(p.message.length).toBeGreaterThan(0);
    expect(p.title.length).toBeGreaterThan(0);
    expect(PLACEMENTS).toContain(p.placement);
    expect(['error', 'warning', 'info', 'success']).toContain(p.severity);
    expect(p.actions).toEqual(CATALOG[code].actions);
  });
});

describe('ERR · present', () => {
  it('fills params into the message', () => {
    const p = present(new AppError('API-401', { conn: 'payments-prod' }));
    expect(p.message).toBe('Sign in again to payments-prod. The cluster rejected the token.');
    expect(p.title).toBe('Sign in again to payments-prod');
    expect(p.body).toBe('The cluster rejected the token.');
    expect(p.placement).toBe('dialog');
  });

  it('splits title/body on the template, so a param containing ". " stays whole', () => {
    const p = present(new AppError('SP-FAILED', { reason: 'Disk full. Retry later' }));
    expect(p.title).toBe('Savepoint failed: Disk full. Retry later');
    expect(p.body).toBe('The job is still running.');
  });

  it('throws in dev for an unknown code', () => {
    expect(() => present(new AppError('NOPE' as ErrorCode))).toThrow(/not in the catalog/);
  });

  it('throws in dev for an unfilled {param}', () => {
    expect(() => present(new AppError('API-401'))).toThrow(/\{conn\}/);
  });
});

describe('ERR · severity', () => {
  it('ALERT-FIRED takes the rule severity, defaulting to the first listed', () => {
    const e = new AppError('ALERT-FIRED', sample('ALERT-FIRED'));
    expect(present(e).severity).toBe('warning');
    e.severity = 'error';
    expect(present(e).severity).toBe('error');
  });

  it('a severity outside the listed ones throws in dev', () => {
    const e = new AppError('API-401', { conn: 'x' });
    e.severity = 'success';
    expect(() => present(e)).toThrow(/not one of/);
  });
});

describe('ERR · placement', () => {
  it.each([
    ['field (SSH section)', 'field'],
    ['panel (test result)', 'panel'],
    ['banner (form) + badge on connection', 'banner'],
    ['object badge + Problems', 'badge'],
    ['toast with Undo (8 s)', 'toast'],
    ['dialog (type-to-confirm)', 'dialog'],
    ['full-page state in tab', 'page'],
    ['Run button tooltip + Problems tab opens', 'field'],
    ['inline + Problems', 'field'],
    ['inline banner', 'banner'],
  ] as const)('%s → %s', (raw, want) => expect(primaryPlacement(raw)).toBe(want));
});

describe('ERR · fromHttp', () => {
  const ctx = { method: 'GET', url: 'https://jm:8081/jobs/abc', conn: 'payments-prod' };
  it.each([
    [401, 'API-401'],
    [403, 'API-403'],
    [404, 'API-404-JOB'],
    [409, 'API-409'],
    [429, 'API-RATE'],
    [500, 'API-5XX'],
    [503, 'API-5XX'],
    [400, 'API-4XX'],
    [415, 'API-4XX'],
  ] as const)('HTTP %i → %s', (status, code) => {
    const e = fromHttp({ status }, ctx);
    expect(e.code).toBe(code);
    expect(e.params.conn).toBe('payments-prod');
    expect(e.http).toEqual({ method: 'GET', url: ctx.url, status });
  });

  it('API-RATE takes the new interval from Retry-After', () => {
    expect(fromHttp({ status: 429, headers: { 'retry-after': '12' } }, ctx).params.s).toBe(12);
  });

  it('a non-error status is a programming error', () => {
    expect(() => fromHttp({ status: 200 }, ctx)).toThrow();
  });
});

describe('ERR · fromTauriHttp', () => {
  const ctx = {
    method: 'GET',
    url: 'https://jm.example.com:8081/config',
    conn: 'payments-prod',
    timeout: 10,
  };
  // What the connection config / Rust error supplies for each kind.
  const extra = {
    reason: 'self-signed',
    proxy: 'proxy.corp:3128',
    status: 407,
    user: 'deploy',
    bastion: 'bastion.corp',
    svc: 'flink-rest',
    ns: 'payments',
    ctx: 'prod-eks',
    s: 2,
    ago: '10 s ago',
  };
  it.each([
    ['dns', 'CONN-DNS'],
    ['refused', 'CONN-REFUSED'],
    ['timeout', 'CONN-TIMEOUT'],
    ['tls_untrusted', 'CONN-TLS-UNTRUSTED'],
    ['tls_changed', 'CONN-CERT-CHANGED'],
    ['tls_other', 'CONN-TLS-UNTRUSTED'],
    ['proxy', 'CONN-PROXY'],
    ['ssh_auth', 'CONN-SSH-AUTH'],
    ['ssh_host_key', 'CONN-SSH-HOSTKEY'],
    ['k8s', 'CONN-K8S-CONTEXT'],
    ['io', 'CONN-LOST'],
  ] as const)('%s → %s', (kind, code) => {
    const e = fromTauriHttp({ kind, message: 'raw transport text', params: extra }, ctx);
    expect(e.code).toBe(code);
    expect(present(e).message).not.toContain('raw transport text');
  });

  it('fills host and port from the URL', () => {
    const e = fromTauriHttp({ kind: 'refused' }, ctx);
    expect(present(e).message).toBe(
      'Nothing is listening on jm.example.com:8081. Is the JobManager running and the port right?',
    );
  });

  it('an unknown error shape is wrapped, never shown raw', () => {
    const e = fromTauriHttp(new Error('boom'), ctx);
    expect(e.code).toBe('CONN-LOST');
    expect(e.cause).toBeInstanceOf(Error);
  });
});

describe('ERR · fromFlinkErrors', () => {
  it('uses the first line of the deepest "Caused by" as {reason}', () => {
    const body = {
      errors: [
        'Internal server error.',
        '<Exception on server side:\norg.apache.flink.runtime.rest.handler.RestHandlerException: Savepoint failed\n\tat X.y(X.java:1)\nCaused by: java.util.concurrent.CompletionException: wrapped\nCaused by: java.io.IOException: Target directory s3://sp is not writable\n\tat Z.z(Z.java:9)\n>',
      ],
    };
    const e = fromFlinkErrors(body, { code: 'SP-FAILED' });
    expect(present(e).message).toBe(
      'Savepoint failed: Target directory s3://sp is not writable. The job is still running.',
    );
    expect(e.detail).toEqual(body);
  });

  it('without "Caused by", takes the first line of the server-side exception, not the generic errors[0]', () => {
    const e = fromFlinkErrors(
      {
        errors: [
          'Internal server error.',
          '<Exception on server side:\norg.apache.flink.runtime.messages.FlinkJobNotFoundException: Could not find Flink job (abc)\n\tat X.y(X.java:1)\n>',
        ],
      },
      { code: 'SP-FAILED' },
    );
    expect(e.params.reason).toBe('Could not find Flink job (abc)');
  });

  it('ignores indented "Caused by" inside Suppressed blocks (re-audit #1)', () => {
    const e = fromFlinkErrors(
      {
        errors: [
          'Internal server error.',
          '<Exception on server side:\nX: Savepoint failed\nCaused by: java.io.IOException: Target directory s3://sp is not writable\n\tSuppressed: java.lang.Exception: close failed\n\t\tCaused by: java.net.SocketTimeoutException: Read timed out\n>',
        ],
      },
      { code: 'SP-FAILED' },
    );
    expect(e.params.reason).toBe('Target directory s3://sp is not writable');
  });

  it('strips every wrapping class name, and keeps a bare exception readable (re-audit #3)', () => {
    const wrapped = fromFlinkErrors(
      {
        errors: [
          '<Exception on server side:\njava.util.concurrent.CompletionException: org.apache.flink.runtime.checkpoint.CheckpointException: Failure to finalize checkpoint\n>',
        ],
      },
      { code: 'SP-FAILED' },
    );
    expect(wrapped.params.reason).toBe('Failure to finalize checkpoint');
    const bare = fromFlinkErrors(
      { errors: ['x', 'Caused by: java.lang.NullPointerException'] },
      { code: 'SP-FAILED' },
    );
    expect(bare.params.reason).toBe('NullPointerException');
  });

  it('falls back to the first non-empty line', () => {
    const e = fromFlinkErrors({ errors: ['', 'Job is not running'] }, { code: 'SP-FAILED' });
    expect(e.params.reason).toBe('Job is not running');
  });
});

describe('ERR · copyDetails', () => {
  it('includes the cause (error name, message, stack) so API-SHAPE details are useful', () => {
    const e = new AppError('API-SHAPE', {}, new TypeError('x.map is not a function'));
    const d = JSON.parse(copyDetails(e, { appVersion: '0.0.0' }));
    expect(d.cause).toMatchObject({ name: 'TypeError', message: 'x.map is not a function' });
    expect(typeof d.cause.stack).toBe('string');
  });

  it('includes a transport error cause as-is, redacted', () => {
    const e = fromTauriHttp(
      { kind: 'tls_other', message: 'invalid peer certificate: UnknownIssuer', token: 's3cret' },
      { method: 'GET', url: 'https://jm:8081/config', reason: 'unknown issuer' },
    );
    const json = copyDetails(e, { appVersion: '0.0.0' });
    expect(JSON.parse(json).cause.message).toBe('invalid peer certificate: UnknownIssuer');
    expect(json).not.toContain('s3cret');
  });

  it('redacts tokens, passwords and Authorization', () => {
    const e = new AppError('API-401', { conn: 'payments-prod', token: 'abc123' }, undefined, {
      headers: { Authorization: 'Bearer abc123' },
      note: 'sent Bearer abc123 to https://u:pw@jm/x?token=abc123&a=1',
    });
    e.http = { method: 'GET', url: 'https://jm:8081/config?access_token=abc123', status: 401 };
    const json = copyDetails(e, { appVersion: '0.0.0', flinkVersion: '2.2.0' });
    expect(json).not.toContain('abc123');
    expect(json).not.toContain('u:pw');
    const d = JSON.parse(json);
    expect(d).toMatchObject({ code: 'API-401', appVersion: '0.0.0', flinkVersion: '2.2.0' });
    expect(d.message).toBe('Sign in again to payments-prod. The cluster rejected the token.');
    expect(d.http.status).toBe(401);
    expect(typeof d.time).toBe('string');
  });
});
