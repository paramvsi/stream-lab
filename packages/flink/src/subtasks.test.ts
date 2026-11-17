import { describe, expect, it } from 'vitest';
import type { FlinkHttp } from './http';
import { getSubtaskLoads, skew } from './subtasks';

const ok = (body: unknown) => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });

describe('JOB-03 · subtask loads (D09c)', () => {
  it('reads each subtask in turn: records in / s and busy % (ms per second / 10); asks only the two metrics', async () => {
    const asked: string[] = [];
    let inFlight = 0;
    let most = 0;
    const http: FlinkHttp = async (r) => {
      asked.push(`${r.path}?${new URLSearchParams(r.query).toString()}`);
      most = Math.max(most, ++inFlight);
      await Promise.resolve();
      inFlight--;
      const i = Number(/subtasks\/(\d+)\//.exec(r.path)![1]);
      return ok([
        { id: 'busyTimeMsPerSecond', value: String([990, 340][i]) },
        { id: 'numRecordsInPerSecond', value: String([2410.4, 820][i]) },
      ]);
    };
    const l = await getSubtaskLoads(http, 'prod', 'j 1', 'v1', 2);
    expect(l).toEqual([
      { index: 0, recIn: 2410.4, busy: 99 },
      { index: 1, recIn: 820, busy: 34 },
    ]);
    expect(asked[0]).toBe(
      '/jobs/j%201/vertices/v1/subtasks/0/metrics?get=numRecordsInPerSecond%2CbusyTimeMsPerSecond',
    );
    expect(most).toBe(1);
  });

  it('a metric Flink left out, or NaN ("could not be calculated"), is no reading (null), never 0', async () => {
    const l = await getSubtaskLoads(
      async () => ok([{ id: 'busyTimeMsPerSecond', value: 'NaN' }]),
      'prod',
      'j',
      'v',
      1,
    );
    expect(l).toEqual([{ index: 0, recIn: null, busy: null }]);
  });

  it('skew: the busiest subtask against the mean of the others; none below 2 subtasks or no traffic', () => {
    const at = (...r: (number | null)[]) => r.map((recIn, index) => ({ index, recIn, busy: null }));
    expect(skew(at(2410, 820, 860, 790))).toEqual({ index: 0, times: 2.9 });
    expect(skew(at(100))).toBeNull();
    expect(skew(at(0, 0))).toBeNull();
    expect(skew(at(5, null))).toBeNull();
  });
});
