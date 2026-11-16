import { describe, expect, it } from 'vitest';
import { exportConnections, importConnections, validateConnection, type Connection } from './connection';

const conn = (over: Partial<Connection> = {}): Connection => ({
  id: 'c1',
  name: 'prod-eu',
  url: 'https://flink.example.com:8081',
  kind: 'standalone',
  env: 'prod',
  readOnly: false,
  basePath: '',
  auth: { type: 'none' },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: 10000,
  pollMs: 5000,
  ...over,
});
const codes = (e: ReturnType<typeof validateConnection>) =>
  Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v!.code]));

describe('CONN-02 validation', () => {
  it('a complete connection has no problems', () => {
    expect(validateConnection(conn(), ['staging'])).toEqual({});
  });
  it('required fields, a bad address, a taken name (case-insensitive)', () => {
    expect(codes(validateConnection(conn({ name: ' ', url: '' }), []))).toEqual({
      name: 'CONN-REQUIRED',
      url: 'CONN-REQUIRED',
    });
    expect(codes(validateConnection(conn({ url: 'flink.example.com:8081' }), []))).toEqual({
      url: 'CONN-URL-INVALID',
    });
    expect(codes(validateConnection(conn({ url: 'ftp://x' }), []))).toEqual({ url: 'CONN-URL-INVALID' });
    expect(codes(validateConnection(conn({ name: 'Prod-EU ' }), ['prod-eu']))).toEqual({
      name: 'CONN-NAME-TAKEN',
    });
    expect(validateConnection(conn({ name: '' }), []).name!.params).toEqual({ field: 'Name' });
  });
  it('auth and transport fields; Authorization in custom headers is refused (CONN-HEADER-AUTH)', () => {
    expect(codes(validateConnection(conn({ auth: { type: 'basic', user: '' } }), []))).toEqual({
      user: 'CONN-REQUIRED',
    });
    expect(codes(validateConnection(conn({ auth: { type: 'token-command', command: ' ' } }), []))).toEqual({
      command: 'CONN-REQUIRED',
    });
    expect(codes(validateConnection(conn({ auth: { type: 'mtls', cert: '', key: '' } }), []))).toEqual({
      cert: 'CONN-REQUIRED',
      key: 'CONN-REQUIRED',
    });
    expect(codes(validateConnection(conn({ transport: { type: 'proxy', url: 'nope' } }), []))).toEqual({
      proxy: 'CONN-URL-INVALID',
    });
    expect(
      codes(
        validateConnection(
          conn({ headers: [{ name: 'authorization', value: 'Bearer x', secret: false }] }),
          [],
        ),
      ),
    ).toEqual({ headers: 'CONN-HEADER-AUTH' });
  });
});

describe('CONN-08 import / export', () => {
  const withSecret = conn({
    headers: [
      { name: 'X-Api-Key', value: 'TOPSECRET', secret: true },
      { name: 'X-Team', value: 'payments', secret: false },
    ],
  });
  it('export leaves secrets out; import reads it back', () => {
    const text = exportConnections([withSecret]);
    expect(text).not.toContain('TOPSECRET');
    expect(text).toContain('payments');
    const r = importConnections('c.json', text, []);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.connections[0]!.headers[0]).toEqual({ name: 'X-Api-Key', secret: true });
    expect(r.dupError).toBeNull();
  });
  it('a broken file names its line and why; nothing is imported (CONN-IMPORT-INVALID)', () => {
    const r = importConnections('c.json', '{\n  "format": "streamlab.connections",\n  oops\n}', []);
    expect(r).toMatchObject({ error: { code: 'CONN-IMPORT-INVALID', params: { file: 'c.json', line: 3 } } });
    const bad = JSON.stringify(
      { format: 'streamlab.connections', version: 1, connections: [{ ...conn(), id: 'c9', env: 'qa' }] },
      null,
      2,
    );
    const r2 = importConnections('c.json', bad, []);
    expect(r2).toMatchObject({ error: { code: 'CONN-IMPORT-INVALID', params: { line: 6 } } });
    expect(String((r2 as unknown as { error: { params: { reason: string } } }).error.params.reason)).toMatch(
      /^connections\.0\.env/,
    );
    expect(importConnections('x.json', '{"hello":1}', [])).toMatchObject({
      error: { code: 'CONN-IMPORT-INVALID' },
    });
  });
  it('names that already exist are reported for skip / replace / keep both (CONN-IMPORT-DUP)', () => {
    const r = importConnections('c.json', exportConnections([conn(), conn({ id: 'c2', name: 'dev' })]), [
      'PROD-EU',
    ]);
    expect(r).toMatchObject({
      duplicates: ['prod-eu'],
      dupError: { code: 'CONN-IMPORT-DUP', params: { n: 1 } },
    });
  });
});

describe('audit of 77b0572', () => {
  it('#1 a file that is JSON null is CONN-IMPORT-INVALID, not a crash', () => {
    expect(importConnections('c.json', 'null', [])).toMatchObject({ error: { code: 'CONN-IMPORT-INVALID' } });
  });
  it('#2 a user and password in an address are refused (CONN-URL-SECRET), for REST, proxy and gateway', () => {
    expect(
      codes(validateConnection(conn({ url: 'https://alice:s3cret@flink.example.com:8081' }), [])),
    ).toEqual({
      url: 'CONN-URL-SECRET',
    });
    expect(
      codes(validateConnection(conn({ transport: { type: 'proxy', url: 'http://u:pw@proxy:3128' } }), [])),
    ).toEqual({
      proxy: 'CONN-URL-SECRET',
    });
    expect(
      codes(validateConnection(conn({ gateway: { url: 'https://u:p@gw:8083', sameLogin: true } }), [])),
    ).toEqual({ gateway: 'CONN-URL-SECRET' });
  });
  it('#3 imported connections get fresh ids; names twice in the file (any case) are duplicates', () => {
    const text = exportConnections([conn(), conn({ name: 'A' }), conn({ name: 'a' })]);
    const r = importConnections('c.json', text, []);
    if ('error' in r) throw r.error;
    const ids = r.connections.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain('c1');
    expect(r.duplicates).toEqual(['a']);
  });
  it('#8 a separate SQL Gateway login is required when not the same; #9 empty header names; credential headers are not exported', () => {
    expect(
      codes(validateConnection(conn({ gateway: { url: 'https://gw:8083', sameLogin: false } }), [])),
    ).toEqual({
      gatewayLogin: 'CONN-REQUIRED',
    });
    expect(
      codes(validateConnection(conn({ headers: [{ name: ' ', value: 'x', secret: false }] }), [])),
    ).toEqual({
      headers: 'CONN-REQUIRED',
    });
    const text = exportConnections([
      conn({ headers: [{ name: 'Cookie', value: 'session=abc', secret: false }] }),
    ]);
    expect(text).not.toContain('session=abc');
  });
  it('#10 a file that ends early names its last line; a bad connection names the line of its own "id"', () => {
    expect(
      importConnections('c.json', '{\n  "format": "streamlab.connections",\n  "version": 1,', []),
    ).toMatchObject({
      error: { params: { line: 3 } },
    });
    const bad = exportConnections([conn({ name: 'c9' }), conn({ id: 'c9', env: 'qa' as never })]);
    const line = bad.split('\n').findIndex((l) => l.includes('"id": "c9"')) + 1;
    expect(importConnections('c.json', bad, [])).toMatchObject({ error: { params: { line } } });
  });
});
