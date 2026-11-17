import { describe, expect, it } from 'vitest';
import { getCheckpoints, lastCompleted } from './checkpoints';
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

  it('API-SHAPE when the stats can not be read', async () => {
    await expect(getCheckpoints(answer({ counts: {} }), 'prod', 'x')).rejects.toMatchObject({
      code: 'API-SHAPE',
    });
  });
});
