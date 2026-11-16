import { describe, expect, it } from 'vitest';
import {
  exportConnections,
  headerProblem,
  importConnections,
  validateConnection,
  type Connection,
} from './connection';

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
      { id: 'local-1', name: 'PROD-EU' },
    ]);
    expect(r).toMatchObject({
      // "Replace" keeps the existing id (and its keychain entries).
      duplicates: [{ index: 0, existingId: 'local-1' }],
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
  it('#3 imported connections get fresh ids; a name twice in the file (any case) is an invalid file', () => {
    const r = importConnections('c.json', exportConnections([conn(), conn({ name: 'A' })]), []);
    if ('error' in r) throw r.error;
    const ids = r.connections.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('c1');
    const twice = importConnections(
      'c.json',
      exportConnections([conn({ name: 'A' }), conn({ name: 'a ' })]),
      [],
    );
    expect(twice).toMatchObject({ error: { code: 'CONN-IMPORT-INVALID' } });
    expect(
      String((twice as unknown as { error: { params: { reason: string } } }).error.params.reason),
    ).toMatch(/appears twice/);
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

describe('audit of 27279b8', () => {
  it('#1 import checks each connection like the form: a password in an address or an Authorization header is refused', () => {
    const file = (c: Record<string, unknown>) =>
      JSON.stringify(
        { format: 'streamlab.connections', version: 1, connections: [{ ...conn(), ...c }] },
        null,
        2,
      );
    const secret = importConnections(
      'c.json',
      file({ url: 'https://alice:s3cret@flink.example.com:8081' }),
      [],
    );
    expect(secret).toMatchObject({ error: { code: 'CONN-IMPORT-INVALID' } });
    const auth = importConnections(
      'c.json',
      file({ headers: [{ name: 'Authorization', value: 'Bearer x', secret: false }] }),
      [],
    );
    expect(auth).toMatchObject({ error: { code: 'CONN-IMPORT-INVALID' } });
    // Export never writes them either.
    const text = exportConnections([
      conn({
        url: 'https://alice:s3cret@flink.example.com:8081',
        headers: [{ name: 'X-Auth-Token', value: 'T0K', secret: false }],
      }),
    ]);
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('T0K');
  });
  it('#3 a proxy has its own login (user here, password in the keychain); #4 credential headers go to the keychain on save', async () => {
    const { splitSecrets, secretKey } = await import('./connection');
    expect(
      validateConnection(conn({ transport: { type: 'proxy', url: 'http://proxy:3128', user: 'bob' } }), []),
    ).toEqual({});
    const { connection, secrets } = splitSecrets(
      conn({ headers: [{ name: 'Cookie', value: 'session=abc', secret: false }] }),
    );
    expect(connection.headers).toEqual([{ name: 'Cookie', secret: true }]);
    expect(secrets).toEqual([{ key: secretKey('c1', 'header:cookie'), value: 'session=abc' }]);
  });
  it('#7 the line of a bad connection is its own, even when ids repeat; #8 the gateway login must be complete, and only when a gateway is set', () => {
    const text = JSON.stringify(
      {
        format: 'streamlab.connections',
        version: 1,
        connections: [conn({ id: 'x' }), { ...conn({ id: 'x', name: 'b' }), env: 'qa' }],
      },
      null,
      2,
    );
    const line =
      text
        .split('\n')
        .findIndex(
          (l, i, a) => l.includes('"id": "x"') && a.slice(0, i).some((p) => p.includes('"id": "x"')),
        ) + 1;
    expect(importConnections('c.json', text, [])).toMatchObject({ error: { params: { line } } });
    expect(
      codes(
        validateConnection(
          conn({ gateway: { url: 'https://gw:8083', sameLogin: false, auth: { type: 'basic', user: '' } } }),
          [],
        ),
      ),
    ).toEqual({ gatewayLogin: 'CONN-REQUIRED' });
    expect(validateConnection(conn({ gateway: { url: '', sameLogin: false } }), [])).toEqual({});
  });
});

describe('audit of 4b303d6', () => {
  it('#1/#5 a header set twice (any case) or with a bad name is CONN-HEADER-INVALID; an empty secret value is not kept', async () => {
    const { splitSecrets } = await import('./connection');
    const twice = validateConnection(
      conn({
        headers: [
          { name: 'X-Api-Key', value: 'A', secret: true },
          { name: 'x-api-key', value: 'B', secret: true },
        ],
      }),
      [],
    );
    expect(twice.headers).toMatchObject({
      code: 'CONN-HEADER-INVALID',
      params: { name: 'x-api-key', reason: 'is set twice' },
    });
    const bad = validateConnection(
      conn({ headers: [{ name: 'X Bad\nName', value: 'v', secret: false }] }),
      [],
    );
    expect(bad.headers).toMatchObject({ code: 'CONN-HEADER-INVALID' });
    expect(splitSecrets(conn({ headers: [{ name: 'X-Token', value: '', secret: true }] })).secrets).toEqual(
      [],
    );
  });
  it('#2 an exported connection always imports again (an old Authorization header is left out); #4 secret values in a file are not taken', () => {
    const old = conn({
      headers: [
        { name: 'Authorization', value: 'Bearer x', secret: false },
        { name: 'X-Team', value: 'payments', secret: false },
      ],
    });
    const r = importConnections('c.json', exportConnections([old]), []);
    if ('error' in r) throw r.error;
    expect(r.connections[0]!.headers).toEqual([{ name: 'X-Team', value: 'payments', secret: false }]);
    const hand = JSON.stringify({
      format: 'streamlab.connections',
      version: 1,
      connections: [
        conn({
          headers: [
            { name: 'X-Token', value: 'S3CRET', secret: true },
            { name: 'Cookie', value: 'c=1', secret: false },
          ],
        }),
      ],
    });
    const h = importConnections('c.json', hand, []);
    if ('error' in h) throw h.error;
    expect(JSON.stringify(h.connections)).not.toMatch(/S3CRET|c=1/);
  });
  it('#6 removing a password leaves the rest of the address as written; #7 escaped ids find their line; #8 the first of two equal existing names', () => {
    const t = exportConnections([conn({ url: 'https://u:p@Flink.Example.com:443/base?x=1' })]);
    expect(t).toContain('"url": "https://Flink.Example.com:443/base?x=1"');
    const text =
      '{\n "format": "streamlab.connections",\n "version": 1,\n "connections": [\n  {\n   "id": "\\u00e9\\/x",\n   "env": "qa"\n  }\n ]\n}';
    expect(importConnections('c.json', text, [])).toMatchObject({ error: { params: { line: 6 } } });
    const r = importConnections('c.json', exportConnections([conn()]), [
      { id: 'e1', name: 'prod-eu' },
      { id: 'e2', name: 'PROD-EU' },
    ]);
    expect(r).toMatchObject({ duplicates: [{ index: 0, existingId: 'e1' }] });
  });
});

describe('audit of 9f33c74', () => {
  it('#1 a password containing "@", or an address with leading space, loses its whole login', () => {
    const urlOf = (u: string) =>
      JSON.parse(exportConnections([conn({ url: u })])).connections[0].url as string;
    expect(urlOf('http://u:p@ss@host:8081/x')).toBe('http://host:8081/x');
    for (const u of [' http://u:p@host/', '\thttp://u:p@host', 'http:u:p@host/']) {
      const out = urlOf(u);
      expect(out, u).not.toMatch(/u:p|p@/);
      expect(new URL(out.trim()).username, u).toBe('');
    }
  });
  it('#2 a connection saved with a repeated or bad header name still exports something that imports', () => {
    const old = conn({
      headers: [
        { name: 'X-Team', value: 'a', secret: false },
        { name: 'x-team', value: 'b', secret: false },
        { name: 'X Team', value: 'c', secret: false },
      ],
    });
    const r = importConnections('c.json', exportConnections([old]), []);
    if ('error' in r) throw r.error;
    expect(r.connections[0]!.headers).toEqual([{ name: 'X-Team', value: 'a', secret: false }]);
  });
  it('an embedded catalog message does not end in a doubled full stop', () => {
    const bad = JSON.stringify({
      format: 'streamlab.connections',
      version: 1,
      connections: [conn({ url: 'nope' })],
    });
    const r = importConnections('c.json', bad, []);
    expect(
      String((r as unknown as { error: { params: { reason: string } } }).error.params.reason),
    ).not.toMatch(/\.$/);
  });
});

describe('audit of acd5109', () => {
  it('#1 a backslash ends the host: the address keeps its host, with or without a login', () => {
    const urlOf = (u: string) =>
      JSON.parse(exportConnections([conn({ url: u })])).connections[0].url as string;
    for (const u of ['https://u:p@host\\a@b', 'https://host\\a@b']) {
      const out = urlOf(u);
      expect(new URL(out).host, u).toBe('host');
      expect(new URL(out).username, u).toBe('');
    }
  });
  it('#3 a bad header name shows backslashes and quotes as typed, invisible characters escaped', () => {
    expect(
      validateConnection(conn({ headers: [{ name: 'X\\"T', value: 'v', secret: false }] }), []).headers!
        .params,
    ).toMatchObject({ name: 'X\\"T' });
    expect(
      validateConnection(conn({ headers: [{ name: 'X‮T', value: 'v', secret: false }] }), []).headers!.params,
    ).toMatchObject({ name: 'X\\u{202e}T' });
  });
});

describe('audit of db78f52', () => {
  it('#1 a password with a backslash (an address the parser can not read) is still cut', () => {
    const t = exportConnections([conn({ url: 'https://user:pa\\ss@flink.example.com' })]);
    expect(t).not.toContain('pa\\\\ss');
    expect(t).not.toContain('user:');
  });
});

describe('audit of 276dfa0', () => {
  it('#8 an unreadable address with "/" in its password still loses the login', () => {
    const t = exportConnections([conn({ url: 'https://u:p/ss@flink.example.com' })]);
    expect(t).not.toContain('p/ss');
  });
});

describe('audit of 17e57df', () => {
  it('#1 an imported address with a no-break space keeps its host on export; #2 the reason names the field once', () => {
    const file = JSON.stringify({
      format: 'streamlab.connections',
      version: 1,
      connections: [conn({ url: ' https://flink.example.com:8081/proxy/a@b' })],
    });
    const r = importConnections('c.json', file, []);
    if ('error' in r) throw r.error;
    const out = JSON.parse(exportConnections(r.connections)).connections[0].url as string;
    expect(new URL(out).host).toBe('flink.example.com:8081');
    const bad = JSON.stringify({
      format: 'streamlab.connections',
      version: 1,
      connections: [conn({ name: 'p', url: '' })],
    });
    expect(importConnections('c.json', bad, [])).toMatchObject({
      error: { params: { reason: 'p: JobManager REST URL is required' } },
    });
  });
  it('#3 Hangul fillers, variation selectors and the combining grapheme joiner are shown escaped', () => {
    const e = validateConnection(conn({ headers: [{ name: 'Xㅤ️͏T', value: 'v', secret: false }] }), []);
    expect(e.headers!.params).toMatchObject({ name: 'X\\u{3164}\\u{fe0f}\\u{34f}T' });
  });
});

describe('audit of 62f3388', () => {
  it('#1 an import error on the proxy address says it is the proxy; #9 names are stored trimmed', () => {
    const bad = JSON.stringify({
      format: 'streamlab.connections',
      version: 1,
      connections: [conn({ name: 'p', transport: { type: 'proxy', url: 'nope' } })],
    });
    expect(importConnections('c.json', bad, [])).toMatchObject({
      error: {
        params: { reason: 'p, Proxy address: Enter a full address like https://flink.example.com:8081' },
      },
    });
    const r = importConnections('c.json', exportConnections([conn({ name: 'pay ' })]), []);
    if ('error' in r) throw r.error;
    expect(r.connections[0]!.name).toBe('pay');
  });
});

describe('audit of 3b050a8', () => {
  it('#4 #5 #6 import stores the base path as the form does; path characters only; the row of a header problem', () => {
    const imp = (basePath: string) => {
      const r = importConnections('c.json', exportConnections([conn({ name: 'p', basePath })]), []);
      return 'error' in r ? 'REFUSED' : r.connections[0]!.basePath;
    };
    expect(imp(' /a/ ')).toBe('/a');
    expect(imp('/a//')).toBe('/a');
    expect(imp('/')).toBe('');
    expect(imp('/proxy/application_1_0001/')).toBe('/proxy/application_1_0001');
    for (const bad of ['/a?x=1', '/a#f', '/a\\b', '/u@h', 'a/b', '/a//b']) expect(imp(bad)).toBe('REFUSED');
    expect(headerProblem([{ name: 'X-A' }, { name: 'x-a' }])).toMatchObject({
      index: 1,
      error: { code: 'CONN-HEADER-INVALID' },
    });
    expect(headerProblem([{ name: 'X-A' }, { name: '' }])).toMatchObject({
      index: 1,
      error: { code: 'CONN-REQUIRED' },
    });
    expect(headerProblem([{ name: 'X-A' }, { name: 'authorization' }])).toMatchObject({
      index: 1,
      error: { code: 'CONN-HEADER-AUTH' },
    });
  });
});

describe('audit of 9e989a0', () => {
  const v = (basePath: string) => validateConnection(conn({ basePath }), []).basePath?.code ?? 'ok';
  it('valid base paths are accepted (dots inside names, %-escapes in either case)', () => {
    for (const ok of [
      '/.well-known/x',
      '/a.b/c',
      '/v1.2',
      '/proxy/application_1_0001',
      '/a%C3%BC',
      '/...',
      '/..a',
      '/a%2e%2e',
      '/a;b=c',
      "/a!b$c&d'e(f)*+,:",
    ])
      expect([ok, v(ok)]).toEqual([ok, 'ok']);
  });
  it('dot segments even when %-encoded, encoded controls, and anything outside ASCII path characters are refused', () => {
    for (const bad of [
      '/%2e%2e/admin',
      '/%2E%2E/admin',
      '/.%2e/admin',
      '/%2e/x',
      '/a/%2E',
      '/a%00',
      '/a%0d%0a',
      '/a%7F',
      '/a\u180b',
      '/a\ufff9',
      '/a\u2800',
      '/日本',
      '/a%10',
      '/a%1f',
      '/zürich',
      '/%2F',
      '/%2f',
      '/%2e%2e%2fadmin',
      '/a%5c..',
      '/a%e2%80%8b',
      '/a%ef%bb%bf',
      '/a%c2%80',
      '/a%80',
      '/50%off',
      '/a%20b',
      '/%c2%a0',
      '/%3f',
      '/%23',
      '/%40',
      '/a%e2%80%a8',
      '/a%e2%80%a9',
      '/a%ef%bf%bf',
      '/a%ef%b7%90',
      '/a%ef%bf%be',
      '/a%f0%9f%bf%be',
      '/a%f4%8f%bf%bf',
    ])
      expect([bad, v(bad)]).toEqual([bad, 'CONN-BASEPATH-FORMAT']);
  });
});
