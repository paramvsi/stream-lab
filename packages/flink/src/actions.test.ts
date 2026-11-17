import { describe, expect, it } from 'vitest';
import { cancelJob, savepointStatus, stopWithSavepoint, triggerSavepoint } from './actions';
import { TransportError, type FlinkHttp, type FlinkRequest } from './http';

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

  it('no 409 is invented for trigger/stop: Flink\'s "already in progress" text is API-409; its 400 for no folder is SP-DIR-MISSING', async () => {
    const text = (status: number, msg: string) => async () => ({
      status,
      headers: {},
      url: '',
      body: JSON.stringify({ errors: [msg] }),
    });
    await expect(
      stopWithSavepoint(
        text(500, 'Internal server error. A savepoint is already in progress.'),
        'prod',
        'j',
        'refund-matcher',
        { dir: 's3://sp', drain: false },
      ),
    ).rejects.toMatchObject({ code: 'API-409', params: { job: 'refund-matcher' } });
    await expect(
      triggerSavepoint(
        text(
          400,
          'Config key [state.savepoints.dir] is not set. Property [target-directory] must be provided.',
        ),
        'prod',
        'j',
        'refund-matcher',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'SP-DIR-MISSING' });
    await expect(
      triggerSavepoint(text(500, 'Internal server error.'), 'prod', 'j', 'refund-matcher', 's3://sp'),
    ).rejects.toMatchObject({
      code: 'API-5XX',
    });
  });

  it('a timeout is CONN-TIMEOUT and is not retried', async () => {
    let n = 0;
    await expect(
      stopWithSavepoint(
        async () => {
          n++;
          throw new TransportError({ kind: 'timeout', host: 'payments-prod.example.com', timeoutS: 10 });
        },
        'prod',
        'j',
        'refund-matcher',
        { dir: 's3://sp', drain: false },
      ),
    ).rejects.toMatchObject({ code: 'CONN-TIMEOUT' });
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
    await cancelJob(http, 'prod', 'j', 'refund-matcher');
    expect(seen).toEqual([
      expect.objectContaining({ method: 'PATCH', path: '/jobs/j', query: { mode: 'cancel' } }),
    ]);
  });

  it("cancel's 409 (Flink: the job already reached another terminal state) is API-409 with that state", async () => {
    const body = {
      errors: [
        'Job cancellation failed because the job has already reached another terminal state (FINISHED).',
      ],
    };
    await expect(
      cancelJob(
        async () => ({ status: 409, headers: {}, url: '', body: JSON.stringify(body) }),
        'prod',
        'j',
        'refund-matcher',
      ),
    ).rejects.toMatchObject({ code: 'API-409', params: { job: 'refund-matcher', state: 'finished' } });
  });

  it('a savepoint that failed because another was already in progress is API-409, not SP-FAILED', async () => {
    const s = await savepointStatus(
      async () =>
        reply(200, {
          status: { id: 'COMPLETED' },
          operation: {
            'failure-cause': {
              class: 'x.CheckpointException',
              'stack-trace': 'x.CheckpointException: A savepoint is already in progress.',
            },
          },
        }),
      'prod',
      'j',
      'r',
      'refund-matcher',
    );
    expect(s).toMatchObject({ done: true, error: { code: 'API-409', params: { job: 'refund-matcher' } } });
  });
});
