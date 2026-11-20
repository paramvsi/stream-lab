import { describe, expect, it } from 'vitest';
import { bottlenecks, getBackpressure } from './backpressure';
import type { FlinkHttp } from './http';

const sub = (subtask: number, ratio: number, level = 'ok') => ({
  subtask,
  backpressureLevel: level,
  'backpressure-level': level,
  ratio,
  idleRatio: 0,
  busyRatio: 1 - ratio,
});
const answer =
  (body: unknown, status = 200): FlinkHttp =>
  async () => ({ status, headers: {}, url: '', body: JSON.stringify(body) });

describe('JOB-BACKPRESSURE · vertex backpressure (D08b)', () => {
  it('reads the level and the worst subtask as a percent; the request names job and vertex', async () => {
    let path = '';
    const b = await getBackpressure(
      async (r) => (
        (path = r.path),
        answer({
          status: 'ok',
          backpressureLevel: 'high',
          'end-timestamp': 9,
          subtasks: [sub(0, 0.12), sub(1, 0.97, 'high')],
        })(r)
      ),
      'prod',
      'j/1',
      'v/2',
      'RUNNING',
    );
    expect(path).toBe('/jobs/j%2F1/vertices/v%2F2/backpressure');
    expect(b).toEqual({ level: 'high', pct: 97 });
  });

  it('"deprecated" (no fresh sample yet) is no reading, not 0 %', async () => {
    const b = await getBackpressure(
      answer({ status: 'deprecated', subtasks: [] }),
      'prod',
      'j',
      'v',
      'RUNNING',
    );
    expect(b).toBeNull();
  });

  it('accepts the older "backpressure-level" key alone', async () => {
    const b = await getBackpressure(
      answer({ status: 'ok', 'backpressure-level': 'low', subtasks: [sub(0, 0.2, 'low')] }),
      'prod',
      'j',
      'v',
      'RUNNING',
    );
    expect(b).toEqual({ level: 'low', pct: 20 });
  });

  it('API-SHAPE when it can not be read', async () => {
    await expect(
      getBackpressure(answer({ subtasks: 'x' }), 'prod', 'j', 'v', 'RUNNING'),
    ).rejects.toMatchObject({
      code: 'API-SHAPE',
    });
  });

  it('audit: a job that is not running has no reading, and no request (Flink keeps serving its last values as "ok")', async () => {
    let asked = 0;
    const http: FlinkHttp = async (r) => (
      asked++,
      answer({ status: 'ok', backpressureLevel: 'high', subtasks: [sub(0, 0.97, 'high')] })(r)
    );
    for (const state of ['FINISHED', 'FAILED', 'CANCELED', 'RESTARTING'])
      expect(await getBackpressure(http, 'prod', 'j', 'v', state)).toBeNull();
    expect(asked).toBe(0);
  });
});

describe('D08f bottlenecks (Flink docs: first not-backpressured operator downstream)', () => {
  const g = {
    nodes: [{ id: 'src' }, { id: 'val' }, { id: 'win' }, { id: 'sink' }],
    edges: [
      { from: 'src', to: 'val' },
      { from: 'val', to: 'win' },
      { from: 'win', to: 'sink' },
    ],
  };
  const hi = { level: 'high' as const, pct: 87 };
  const ok = { level: 'ok' as const, pct: 2 };
  it('the OK operator fed by a HIGH one', () => {
    expect(bottlenecks(g, { src: hi, val: hi, win: ok, sink: ok })).toEqual(['win']);
  });
  it('no reading on the candidate, or none HIGH: nothing said', () => {
    expect(bottlenecks(g, { src: hi, val: hi, win: null, sink: ok })).toEqual([]);
    expect(bottlenecks(g, { src: ok, val: { level: 'low', pct: 30 }, win: ok, sink: ok })).toEqual([]);
  });
});
