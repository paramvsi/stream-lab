import { describe, expect, it } from 'vitest';
import type { FlinkHttp } from './http';
import { getJob } from './job';

const vertex = {
  id: 'v1',
  name: 'Source: payments',
  parallelism: 4,
  maxParallelism: 128,
  slotSharingGroupId: 'g',
  'start-time': 1,
  'end-time': -1,
  duration: 10,
  status: 'RUNNING',
  tasks: { RUNNING: 4 },
  metrics: {
    'read-bytes': 0,
    'read-bytes-complete': true,
    'read-records': 0,
    'read-records-complete': true,
    'write-bytes': 10,
    'write-bytes-complete': true,
    'write-records': 1200,
    'write-records-complete': true,
    'accumulated-backpressured-time': 0,
    'accumulated-idle-time': 5,
    'accumulated-busy-time': 1.5,
  },
};
const detail = {
  jid: 'a5e0edd8e66b53f1b89c2041',
  name: 'refund-matcher',
  isStoppable: false,
  state: 'RUNNING',
  'job-type': 'STREAMING',
  'start-time': 1,
  'end-time': -1,
  duration: 10,
  maxParallelism: -1,
  now: 11,
  timestamps: { RUNNING: 1 },
  vertices: [vertex],
  'status-counts': { RUNNING: 1 },
  plan: { jid: 'a5e0edd8e66b53f1b89c2041', name: 'refund-matcher', nodes: [] },
};
const answer =
  (status: number, body: unknown): FlinkHttp =>
  async () => ({ status, headers: {}, url: '', body: JSON.stringify(body) });

describe('JOB-02 · job detail (GET /jobs/:jid)', () => {
  it('reads the job and its vertices', async () => {
    let path = '';
    const j = await getJob(async (req) => ((path = req.path), answer(200, detail)(req)), 'prod', detail.jid);
    expect(path).toBe(`/jobs/${detail.jid}`);
    expect(j.name).toBe('refund-matcher');
    expect(j.vertices[0]).toMatchObject({ name: 'Source: payments', parallelism: 4 });
    expect(j.vertices[0]!.metrics?.['write-records']).toBe(1200);
  });

  it('a metric Flink can not measure ("NaN": a legacy source, a task not started) is null, not a broken page', async () => {
    const v = { ...vertex, metrics: { ...vertex.metrics, 'accumulated-busy-time': 'NaN' } };
    const j = await getJob(answer(200, { ...detail, vertices: [v] }), 'prod', detail.jid);
    expect(j.vertices[0]!.metrics?.['accumulated-busy-time']).toBeNull();
    expect(j.vertices[0]!.metrics?.['write-records']).toBe(1200);
  });

  it('encodes the job id in the path', async () => {
    let path = '';
    await getJob(async (req) => ((path = req.path), answer(200, detail)(req)), 'prod', 'a/b');
    expect(path).toBe('/jobs/a%2Fb');
  });

  it('a job the cluster no longer has is API-404-JOB (D07c), not a generic 4xx', async () => {
    await expect(getJob(answer(404, { errors: ['Job not found'] }), 'prod', 'x')).rejects.toMatchObject({
      code: 'API-404-JOB',
      params: { thing: 'job', conn: 'prod' }, // both catalog params filled
    });
  });

  it('API-SHAPE when the detail can not be read', async () => {
    await expect(getJob(answer(200, { jid: 'x' }), 'prod', 'x')).rejects.toMatchObject({ code: 'API-SHAPE' });
  });
});
