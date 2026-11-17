import { AppError } from '@sl/errors';
import { describe, expect, it } from 'vitest';
import type { FlinkJobRow } from './endpoints/jobs';
import type { FlinkHttp } from './http';
import { bucketCounts, listJobs, queryJobs } from './jobs';

const row = (jid: string, name: string, state: string, start: number, duration: number): FlinkJobRow => ({
  jid,
  name,
  state,
  'start-time': start,
  'end-time': -1,
  duration,
  'last-modification': start,
});
const rows = [
  row('a1', 'fraud-scoring', 'RUNNING', 300, 30),
  row('b2', 'card-velocity', 'RESTARTING', 100, 90),
  row('c3', 'daily-totals', 'FINISHED', 200, 60),
  row('d4', 'blocklist-sync', 'CANCELED', 400, 10),
];

describe('JOB-01 · jobs list', () => {
  it('counts the board chips: running, failing and finished partition all jobs', () => {
    expect(bucketCounts(rows)).toEqual({ all: 4, running: 1, failing: 1, finished: 2 });
  });

  it('filters by chip', () => {
    expect(queryJobs(rows, { bucket: 'failing' }).map((r) => r.jid)).toEqual(['b2']);
    expect(queryJobs(rows, { bucket: 'finished' }).map((r) => r.jid)).toEqual(['c3', 'd4']);
  });

  it('searches by name or ID, ignoring case and spaces around it', () => {
    expect(queryJobs(rows, { q: '  FRAUD ' }).map((r) => r.jid)).toEqual(['a1']);
    expect(queryJobs(rows, { q: 'd4' }).map((r) => r.jid)).toEqual(['d4']);
  });

  it('search also matches the state and its chip word (board D07b: "fail" finds the restarting job)', () => {
    expect(queryJobs(rows, { q: 'fail', bucket: 'failing' }).map((r) => r.jid)).toEqual(['b2']);
    expect(queryJobs(rows, { q: 'canceled' }).map((r) => r.jid)).toEqual(['d4']);
  });

  it('sorts by name, start time or duration, both ways, and does not change the input', () => {
    const before = rows.map((r) => r.jid);
    expect(queryJobs(rows, { sort: 'name' }).map((r) => r.jid)).toEqual(['d4', 'b2', 'c3', 'a1']);
    expect(queryJobs(rows, { sort: 'start', desc: true }).map((r) => r.jid)).toEqual([
      'd4',
      'a1',
      'c3',
      'b2',
    ]);
    // Uptime: finished jobs (c3, d4) have none, so they group at one end, in list order.
    expect(queryJobs(rows, { sort: 'duration' }).map((r) => r.jid)).toEqual(['c3', 'd4', 'a1', 'b2']);
    expect(rows.map((r) => r.jid)).toEqual(before);
  });

  it('reads GET /jobs/overview', async () => {
    const http: FlinkHttp = async (req) => {
      expect(req).toMatchObject({ method: 'GET', path: '/jobs/overview' });
      return { status: 200, headers: {}, body: JSON.stringify({ jobs: rows }), url: 'https://f' };
    };
    expect((await listJobs(http, 'prod-eu')).map((r) => r.name)).toEqual(rows.map((r) => r.name));
  });

  it('API-SHAPE when the list can not be read', async () => {
    const http: FlinkHttp = async () => ({
      status: 200,
      headers: {},
      body: '{"jobs":[{"jid":"a"}]}',
      url: 'x',
    });
    await expect(listJobs(http, 'prod-eu')).rejects.toMatchObject({ code: 'API-SHAPE' });
    await expect(listJobs(http, 'prod-eu')).rejects.toBeInstanceOf(AppError);
  });
});
