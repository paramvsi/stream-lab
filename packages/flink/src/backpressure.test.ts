import { describe, expect, it } from 'vitest';
import { getBackpressure } from './backpressure';
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
    );
    expect(path).toBe('/jobs/j%2F1/vertices/v%2F2/backpressure');
    expect(b).toEqual({ level: 'high', pct: 97 });
  });

  it('"deprecated" (no fresh sample yet) is no reading, not 0 %', async () => {
    const b = await getBackpressure(answer({ status: 'deprecated', subtasks: [] }), 'prod', 'j', 'v');
    expect(b).toBeNull();
  });

  it('accepts the older "backpressure-level" key alone', async () => {
    const b = await getBackpressure(
      answer({ status: 'ok', 'backpressure-level': 'low', subtasks: [sub(0, 0.2, 'low')] }),
      'prod',
      'j',
      'v',
    );
    expect(b).toEqual({ level: 'low', pct: 20 });
  });

  it('API-SHAPE when it can not be read', async () => {
    await expect(getBackpressure(answer({ subtasks: 'x' }), 'prod', 'j', 'v')).rejects.toMatchObject({
      code: 'API-SHAPE',
    });
  });
});
