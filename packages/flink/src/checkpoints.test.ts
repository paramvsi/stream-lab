import { describe, expect, it } from 'vitest';
import {
  checkpointingOff,
  getCheckpoints,
  lastCompleted,
  savepointProgress,
  type FlinkCheckpoint,
  type FlinkCheckpointStats,
} from './checkpoints';
import type { FlinkHttp } from './http';

const cp = (id: number, status: string, at: number, extra: Record<string, unknown> = {}) => ({
  id,
  status,
  checkpoint_type: 'CHECKPOINT',
  is_savepoint: false,
  trigger_timestamp: at,
  latest_ack_timestamp: at + 3_400,
  end_to_end_duration: 3_400,
  checkpointed_size: 220_000_000,
  state_size: 900_000_000,
  num_subtasks: 4,
  num_acknowledged_subtasks: status === 'COMPLETED' ? 4 : 2,
  ...extra,
});
const stats = {
  counts: { completed: 10, failed: 1, in_progress: 1, restored: 0, total: 12 },
  latest: { completed: cp(10, 'COMPLETED', 1_000), failed: null, restored: null, savepoint: null },
  history: [cp(12, 'IN_PROGRESS', 3_000), cp(11, 'FAILED', 2_000), cp(10, 'COMPLETED', 1_000)],
};
const answer =
  (body: unknown, status = 200): FlinkHttp =>
  async () => ({ status, headers: {}, url: '', body: JSON.stringify(body) });

describe('JOB-04 · checkpoints (GET /jobs/:jid/checkpoints)', () => {
  it('reads counts and history; the request names the job', async () => {
    let path = '';
    const s = await getCheckpoints(async (r) => ((path = r.path), answer(stats)(r)), 'prod', 'a/b');
    expect(path).toBe('/jobs/a%2Fb/checkpoints');
    expect(s.counts).toMatchObject({ completed: 10, failed: 1 });
    expect(s.history.map((h) => h.status)).toEqual(['IN_PROGRESS', 'FAILED', 'COMPLETED']);
  });

  it('the last completed one feeds D08 "Last checkpoint": duration, size, when', async () => {
    const s = await getCheckpoints(answer(stats), 'prod', 'x');
    expect(lastCompleted(s)).toMatchObject({
      id: 10,
      end_to_end_duration: 3_400,
      checkpointed_size: 220_000_000,
    });
  });

  it('none completed yet: no last checkpoint (null), not a crash', async () => {
    const s = await getCheckpoints(
      answer({
        ...stats,
        latest: { completed: null, failed: null, restored: null, savepoint: null },
        history: [],
      }),
      'prod',
      'x',
    );
    expect(lastCompleted(s)).toBeNull();
  });

  it('a job with no checkpoint settings: Flink\'s 404 "Checkpointing has not been enabled." is JOB-CKPT-NONE', async () => {
    await expect(
      getCheckpoints(answer({ errors: ['Checkpointing has not been enabled.'] }, 404), 'prod', 'x'),
    ).rejects.toMatchObject({ code: 'JOB-CKPT-NONE' });
  });

  it('any other 404 is the job gone (API-404-JOB), not a generic HTTP error', async () => {
    await expect(
      getCheckpoints(answer({ errors: ['Job not found'] }, 404), 'prod', 'x'),
    ).rejects.toMatchObject({
      code: 'API-404-JOB',
      params: { thing: 'job', conn: 'prod' },
    });
  });

  it('checkpointing off on a streaming job: the config interval is Long.MAX_VALUE (counts alone look like "none yet")', async () => {
    let path = '';
    const off = await checkpointingOff(
      async (r) => (
        (path = r.path),
        { status: 200, headers: {}, url: '', body: '{"interval":9223372036854775807,"timeout":600000}' }
      ),
      'prod',
      'a/b',
    );
    expect(path).toBe('/jobs/a%2Fb/checkpoints/config');
    expect(off).toBe(true);
    expect(await checkpointingOff(answer({ interval: 10_000, timeout: 600_000 }), 'prod', 'x')).toBe(false);
  });

  it('the config endpoint\'s own 404 wording ("is not enabled for this job (…)") is off, not the job gone', async () => {
    expect(
      await checkpointingOff(
        answer({ errors: ['Checkpointing is not enabled for this job (a1b2c3).'] }, 404),
        'prod',
        'x',
      ),
    ).toBe(true);
    await expect(
      checkpointingOff(answer({ errors: ['Job not found'] }, 404), 'prod', 'x'),
    ).rejects.toMatchObject({
      code: 'API-404-JOB',
    });
  });

  it('API-SHAPE when the stats can not be read', async () => {
    await expect(getCheckpoints(answer({ counts: {} }), 'prod', 'x')).rejects.toMatchObject({
      code: 'API-SHAPE',
    });
  });
});

describe('D15b savepointProgress', () => {
  const cp = (o: Partial<FlinkCheckpoint>): FlinkCheckpoint => ({
    id: 1,
    status: 'IN_PROGRESS',
    is_savepoint: true,
    trigger_timestamp: 1_000_000,
    latest_ack_timestamp: -1,
    end_to_end_duration: -1,
    checkpointed_size: 146_800_640,
    num_subtasks: 4,
    num_acknowledged_subtasks: 3,
    ...o,
  });
  const stats = (history: FlinkCheckpoint[]): FlinkCheckpointStats => ({
    counts: { completed: 0, failed: 0, in_progress: history.length, restored: 0, total: history.length },
    history,
  });
  it('the running savepoint: bytes written and subtasks acknowledged', () => {
    expect(savepointProgress(stats([cp({})]), 1_000_000)).toEqual({ bytes: 146_800_640, acked: 3, total: 4 });
  });
  it('a running checkpoint, a finished savepoint or an older one is not ours', () => {
    expect(savepointProgress(stats([cp({ is_savepoint: false })]), 1_000_000)).toBeNull();
    expect(savepointProgress(stats([cp({ status: 'COMPLETED' })]), 1_000_000)).toBeNull();
    expect(savepointProgress(stats([cp({ trigger_timestamp: 900_000 })]), 1_000_000)).toBeNull();
  });
  it('no acknowledgement yet: size unknown (-1 or 0), not "0 B"', () => {
    expect(
      savepointProgress(stats([cp({ checkpointed_size: -1, num_acknowledged_subtasks: 0 })]), 1_000_000),
    ).toEqual({ bytes: undefined, acked: 0, total: 4 });
  });
});
