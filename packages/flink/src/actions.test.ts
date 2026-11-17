import { describe, expect, it } from 'vitest';
import { cancelJob, savepointStatus, stopWithSavepoint, triggerSavepoint } from './actions';
import type { FlinkHttp, FlinkRequest } from './http';

const reply = (status: number, body: unknown = {}) => ({
  status,
  headers: {},
  url: '',
  body: JSON.stringify(body),
});
const record = (answer: (r: FlinkRequest) => ReturnType<typeof reply>) => {
  const seen: FlinkRequest[] = [];
  const http: FlinkHttp = async (r) => (seen.push(r), answer(r));
  return { http, seen };
};

describe('ACT-01 / ACT-02 · job actions (FLINK_API "Savepoint", "Stop", "Cancel")', () => {
  it('trigger savepoint: POST target-directory, cancel-job false; gives the request id; one request, never retried', async () => {
    const { http, seen } = record(() => reply(202, { 'request-id': 'r1' }));
    expect(await triggerSavepoint(http, 'prod', 'j 1', 'refund-matcher', 's3://sp')).toBe('r1');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/jobs/j%201/savepoints',
      body: { 'target-directory': 's3://sp', 'cancel-job': false },
    });
  });

  it('stop with savepoint: POST /stop with targetDirectory (camelCase, unlike the trigger) and drain', async () => {
    const { http, seen } = record(() => reply(202, { 'request-id': 'r2' }));
    expect(
      await stopWithSavepoint(http, 'prod', 'j', 'refund-matcher', { dir: 's3://sp', drain: true }),
    ).toBe('r2');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/jobs/j/stop',
      body: { targetDirectory: 's3://sp', drain: true },
    });
  });

  it('no folder given: the cluster default is used (no target in the body)', async () => {
    const { http, seen } = record(() => reply(202, { 'request-id': 'r3' }));
    await triggerSavepoint(http, 'prod', 'j', 'refund-matcher', undefined);
    expect(seen[0]!.body).toEqual({ 'cancel-job': false });
  });

  it('a 409 is API-409 (another operation is on the job), and a timeout is not retried', async () => {
    await expect(
      triggerSavepoint(async () => reply(409), 'prod', 'j', 'refund-matcher', 's3://sp'),
    ).rejects.toMatchObject({
      code: 'API-409',
      params: { job: 'refund-matcher' },
    });
    let n = 0;
    await expect(
      stopWithSavepoint(
        async () => {
          n++;
          throw Object.assign(new Error('timeout'), { name: 'TransportError', kind: 'timeout' });
        },
        'prod',
        'j',
        'refund-matcher',
        { dir: 's3://sp', drain: false },
      ),
    ).rejects.toBeTruthy();
    expect(n).toBe(1);
  });

  it('status: IN_PROGRESS is not done; COMPLETED gives the location, or SP-FAILED with the cause class and message', async () => {
    expect(
      await savepointStatus(async () => reply(200, { status: { id: 'IN_PROGRESS' } }), 'prod', 'j', 'r'),
    ).toEqual({
      done: false,
    });
    expect(
      await savepointStatus(
        async () =>
          reply(200, { status: { id: 'COMPLETED' }, operation: { location: 's3://sp/savepoint-1a2b' } }),
        'prod',
        'j',
        'r',
      ),
    ).toEqual({ done: true, location: 's3://sp/savepoint-1a2b' });
    const failed = await savepointStatus(
      async () =>
        reply(200, {
          status: { id: 'COMPLETED' },
          operation: {
            'failure-cause': {
              class: 'org.apache.flink.runtime.checkpoint.CheckpointException',
              'stack-trace':
                'org.apache.flink.runtime.checkpoint.CheckpointException: Checkpoint expired before completing.\n\tat x',
            },
          },
        }),
      'prod',
      'j',
      'r',
    );
    expect(failed).toMatchObject({
      done: true,
      error: { code: 'SP-FAILED', params: { reason: 'Checkpoint expired before completing' } },
    });
  });

  it('cancel: PATCH /jobs/:jid?mode=cancel, once', async () => {
    const { http, seen } = record(() => reply(202));
    await cancelJob(http, 'prod', 'j');
    expect(seen).toEqual([
      expect.objectContaining({ method: 'PATCH', path: '/jobs/j', query: { mode: 'cancel' } }),
    ]);
  });
});
