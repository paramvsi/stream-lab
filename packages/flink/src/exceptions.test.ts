import { describe, expect, it } from 'vitest';
import { getExceptions, recentFailures, rootCauseLine } from './exceptions';
import type { FlinkHttp } from './http';

const entry = (ts: number, name: string, msg: string) => ({
  exceptionName: name,
  stacktrace: `${name}: ${msg}\n\tat org.example.Foo.bar(Foo.java:12)\n\tat ...`,
  timestamp: ts,
  taskName: 'Window aggregate (2/4)',
  endpoint: '10.0.4.27:41234',
  taskManagerId: 'tm-7',
  failureLabels: {},
  concurrentExceptions: [],
});
const body = {
  'root-exception': 'deprecated',
  exceptionHistory: {
    entries: [
      entry(9_000, 'java.lang.NullPointerException', 'merchant_id is null'),
      entry(5_000, 'java.io.IOException', 'Connection reset'),
    ],
    truncated: false,
  },
};
const answer =
  (b: unknown, status = 200): FlinkHttp =>
  async () => ({ status, headers: {}, url: '', body: JSON.stringify(b) });

describe('JOB-04 · exceptions (GET /jobs/:jid/exceptions, exceptionHistory)', () => {
  it('reads the history (not the deprecated root-exception), newest first, asking for at most 20', async () => {
    let req = { path: '', query: {} as Record<string, string> | undefined };
    const e = await getExceptions(
      async (r) => ((req = { path: r.path, query: r.query }), answer(body)(r)),
      'prod',
      'a/b',
    );
    expect(req.path).toBe('/jobs/a%2Fb/exceptions');
    expect(req.query).toEqual({ maxExceptions: '20' });
    expect(e.entries.map((x) => x.timestamp)).toEqual([9_000, 5_000]);
  });

  it('a global failure without task fields still reads', async () => {
    const g = { exceptionName: 'x.Y', stacktrace: 'x.Y: boom', timestamp: 1 };
    const e = await getExceptions(
      answer({ exceptionHistory: { entries: [g], truncated: false } }),
      'prod',
      'x',
    );
    expect(e.entries).toHaveLength(1);
  });

  it('root cause first line: the stack trace\'s first line ("Name: message"), for JOB-FAILED', () => {
    expect(rootCauseLine(entry(1, 'java.lang.NullPointerException', 'merchant_id is null'))).toBe(
      'java.lang.NullPointerException: merchant_id is null',
    );
    expect(rootCauseLine({ exceptionName: 'x.Y', stacktrace: '' })).toBe('x.Y');
  });

  it('failures in a window (JOB-RESTARTING "restarted {n} times in {period}")', () => {
    const es = [entry(9_000, 'a', 'a'), entry(5_000, 'b', 'b'), entry(1_000, 'c', 'c')];
    expect(recentFailures(es, 10_000, 6_000)).toHaveLength(2);
  });

  it('API-404-JOB when the job is gone', async () => {
    await expect(
      getExceptions(answer({ errors: ['Job x not found'] }, 404), 'prod', 'x'),
    ).rejects.toMatchObject({
      code: 'API-404-JOB',
    });
  });
});
