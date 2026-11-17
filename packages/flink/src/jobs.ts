import { JobsListSchema, type FlinkJobRow } from './endpoints/jobs';
import { getJson, jobBucket, type JobBucket } from './fleet';
import type { FlinkHttp } from './http';

/** GET /jobs/overview for one connection (JOB-01, board D07). Polled every 5 s by the list (FLINK_API.md). */
export async function listJobs(http: FlinkHttp, conn: string, timeoutMs = 10_000): Promise<FlinkJobRow[]> {
  const r = await getJson(
    http,
    conn,
    { method: 'GET', path: '/jobs/overview', timeoutMs },
    JobsListSchema,
    'reading the jobs',
  );
  return r.jobs;
}

/** The chip counts on board D07 ("All 14 · Running 11 · Failing 1 · Finished 2"). */
export function bucketCounts(rows: readonly FlinkJobRow[]): Record<'all' | JobBucket, number> {
  const c = { all: rows.length, running: 0, failing: 0, finished: 0 };
  for (const r of rows) c[jobBucket(r.state)]++;
  return c;
}

export type JobSort = 'name' | 'state' | 'start' | 'duration';
export interface JobQuery {
  /** A chip; none = All. */
  bucket?: JobBucket;
  /**
   * Search by name or job ID (board D07 "Name or ID"); also the state and its chip word, as board D07b shows
   * "fail" finding a restarting job.
   */
  q?: string;
  sort?: JobSort;
  desc?: boolean;
}

const key: Record<JobSort, (r: FlinkJobRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  state: (r) => r.state,
  start: (r) => r['start-time'],
  duration: (r) => r.duration,
};

/** Filter, search and sort the list (JOB-01). A new array; the rows are not changed. */
export function queryJobs(rows: readonly FlinkJobRow[], q: JobQuery): FlinkJobRow[] {
  const needle = q.q?.trim().toLowerCase() ?? '';
  const out = rows.filter(
    (r) =>
      (!q.bucket || jobBucket(r.state) === q.bucket) &&
      (!needle || [r.name, r.jid, r.state, jobBucket(r.state)].some((t) => t.toLowerCase().includes(needle))),
  );
  if (q.sort) {
    const k = key[q.sort];
    const dir = q.desc ? -1 : 1;
    out.sort((a, b) => (k(a) < k(b) ? -dir : k(a) > k(b) ? dir : 0));
  }
  return out;
}
