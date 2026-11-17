import { TaskManagersSchema, type FlinkTaskManager } from './endpoints/jobs';
import { getJson } from './fleet';
import type { FlinkHttp } from './http';

/** GET /taskmanagers for one connection (FLEET-02, board D05b). */
export async function listTaskManagers(
  http: FlinkHttp,
  conn: string,
  timeoutMs = 10_000,
): Promise<FlinkTaskManager[]> {
  const r = await getJson(
    http,
    conn,
    { method: 'GET', path: '/taskmanagers', timeoutMs },
    TaskManagersSchema,
    'reading the TaskManagers',
  );
  return r.taskmanagers;
}

/**
 * Board D05b "Address": the host from the TaskManager's RPC path (`akka.tcp://flink@host:port/…` before 1.18,
 * `pekko…` after; an IPv6 host keeps its brackets); the id when the path has another shape.
 */
export const tmAddress = (t: FlinkTaskManager) => /@(\[[^\]]+\]|[^/:]+)(?::\d+)?\//.exec(t.path)?.[1] ?? t.id;
