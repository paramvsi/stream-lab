import { AppError } from '@sl/errors';
import { JobDetailSchema, type FlinkJobDetail } from './endpoints/jobs';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/**
 * GET /jobs/:jid (JOB-02, board D08). A job the cluster no longer knows (finished and cleaned up, or a stale
 * link) is API-404-JOB, the full-page state, not a generic 4xx.
 */
export async function getJob(
  http: FlinkHttp,
  conn: string,
  jid: string,
  timeoutMs = 10_000,
): Promise<FlinkJobDetail> {
  try {
    return await getJson(
      http,
      conn,
      { method: 'GET', path: `/jobs/${encodeURIComponent(jid)}`, timeoutMs },
      JobDetailSchema,
      'reading the job',
    );
  } catch (e) {
    if (e instanceof AppError && e.code === 'API-4XX' && e.params.status === 404)
      throw new AppError('API-404-JOB', { thing: 'job', conn }, e);
    throw e;
  }
}
