import { describe, expect, it } from 'vitest';
import { TransportError, type FlinkHttp } from './http';
import { MAX_SUBTASKS, getSubtaskLoads, skew } from './subtasks';

const ok = (body: unknown) => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });
const fail = (status: number) => ({ status, headers: {}, url: '', body: '' });

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
    expect(l).toEqual({
      total: 2,
      failed: null,
      loads: [
        { index: 0, recIn: 2410.4, busy: 99 },
        { index: 1, recIn: 820, busy: 34 },
      ],
    });
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
    expect(l.loads).toEqual([{ index: 0, recIn: null, busy: null }]);
    expect(l.failed).toBeNull();
  });

  it('bounded: reads at most MAX_SUBTASKS subtasks however large the parallelism, and says how many there are', async () => {
    let n = 0;
    const l = await getSubtaskLoads(async () => (n++, ok([])), 'prod', 'j', 'v', 500);
    expect(n).toBe(MAX_SUBTASKS);
    expect(l.loads).toHaveLength(MAX_SUBTASKS);
    expect(l.total).toBe(500);
  });

  it('one subtask failing: no reading for it, and the failure is reported (count + catalog error), not hidden', async () => {
    const l = await getSubtaskLoads(
      async (r) =>
        r.path.includes('/subtasks/1/') ? fail(500) : ok([{ id: 'numRecordsInPerSecond', value: '7' }]),
      'prod',
      'j',
      'v',
      3,
    );
    expect(l.loads[1]).toEqual({ index: 1, recIn: null, busy: null });
    expect(l.loads[2]).toEqual({ index: 2, recIn: 7, busy: null });
    expect(l.failed).toMatchObject({ count: 1, error: { code: 'API-5XX' } });
  });

  it('throws only when every read failed: empty answers plus one failure are data, not an error', async () => {
    const l = await getSubtaskLoads(
      async (r) => (r.path.includes('/subtasks/0/') ? fail(500) : ok([])),
      'prod',
      'j',
      'v',
      3,
    );
    expect(l.failed?.count).toBe(1);
    await expect(getSubtaskLoads(async () => fail(500), 'prod', 'j', 'v', 2)).rejects.toMatchObject({
      code: 'API-5XX',
    });
  });

  it('a failure for the whole connection (unreachable, 401, 403) stops at once: one request, not 32 timeouts', async () => {
    const answers: FlinkHttp[] = [
      async () => {
        throw new TransportError({ kind: 'timeout', host: 'h', timeoutS: 10 });
      },
      async () => fail(401),
      async () => fail(403),
    ];
    for (const answer of answers) {
      let n = 0;
      await expect(getSubtaskLoads((r) => (n++, answer(r)), 'prod', 'j', 'v', 40)).rejects.toMatchObject({
        code: expect.stringMatching(/^(CONN-|API-40[13])/),
      });
      expect(n).toBe(1);
    }
  });

  it('a connection error after the cluster has answered is one failed subtask, not a lost table', async () => {
    const l = await getSubtaskLoads(
      async (r) => {
        if (r.path.includes('/subtasks/1/'))
          throw new TransportError({ kind: 'timeout', host: 'h', timeoutS: 10 });
        return ok([{ id: 'numRecordsInPerSecond', value: '5' }]);
      },
      'prod',
      'j',
      'v',
      3,
    );
    expect(l.loads.map((x) => x.recIn)).toEqual([5, null, 5]);
    expect(l.failed).toMatchObject({ count: 1, error: { code: 'CONN-TIMEOUT' } });
  });

  it('the connection dropping mid-round: 2 connection errors in a row end the round (not 31 timeouts)', async () => {
    let n = 0;
    await expect(
      getSubtaskLoads(
        async (r) => {
          n++;
          if (r.path.includes('/subtasks/0/')) return ok([{ id: 'numRecordsInPerSecond', value: '5' }]);
          throw new TransportError({ kind: 'timeout', host: 'h', timeoutS: 10 });
        },
        'prod',
        'j',
        'v',
        32,
      ),
    ).rejects.toMatchObject({ code: 'CONN-TIMEOUT' });
    expect(n).toBe(3);
  });

  it('stops between requests when told to (a closed panel sends nothing more)', async () => {
    let n = 0;
    let stop = false;
    await expect(
      getSubtaskLoads(
        async () => (n++, (stop = true), ok([])),
        'prod',
        'j',
        'v',
        32,
        10_000,
        () => stop,
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('skew: the busiest subtask against the mean of the others; none below 2 subtasks or no traffic', () => {
    const at = (...r: (number | null)[]) => r.map((recIn, index) => ({ index, recIn, busy: null }));
    expect(skew(at(2410, 820, 860, 790))).toEqual({ index: 0, times: 2.9 });
    expect(skew(at(100))).toBeNull();
    expect(skew(at(0, 0))).toBeNull();
    expect(skew(at(5, null))).toBeNull();
  });
});
