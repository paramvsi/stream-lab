import { z } from 'zod';
import type { FlinkJobDetail } from './endpoints/jobs';

/**
 * The `plan` in GET /jobs/:jid (undocumented "RawJson" in the REST reference): JsonPlanGenerator writes nodes
 * with `inputs` (absent on sources) whose items always have `id` and `exchange`, and `ship_strategy` only when set.
 * FLINK: https://github.com/apache/flink/blob/release-1.20/flink-runtime/src/main/java/org/apache/flink/runtime/jobgraph/jsonplan/JsonPlanGenerator.java
 */
const PlanSchema = z.looseObject({
  nodes: z.array(
    z.looseObject({
      id: z.coerce.string(),
      inputs: z
        .array(z.looseObject({ id: z.coerce.string(), ship_strategy: z.string().nullable().optional() }))
        .optional(),
    }),
  ),
});

export interface JobGraph {
  nodes: { id: string; name: string; parallelism: number; status: string }[];
  edges: { from: string; to: string; ship: string | null }[];
}

/**
 * JOB-02 / board D08: the job graph. Nodes are the vertices (their names: the plan's `description` is
 * HTML-escaped); edges come from the plan's inputs. A plan that is missing or unreadable gives the nodes alone.
 */
export function jobGraph(j: FlinkJobDetail): JobGraph {
  const nodes = j.vertices.map((v) => ({
    id: v.id,
    name: v.name,
    parallelism: v.parallelism,
    status: v.status,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const plan = PlanSchema.safeParse(j.plan);
  const edges = plan.success
    ? plan.data.nodes.flatMap((n) =>
        (n.inputs ?? [])
          .filter((i) => ids.has(i.id) && ids.has(n.id))
          .map((i) => ({ from: i.id, to: n.id, ship: i.ship_strategy ?? null })),
      )
    : [];
  return { nodes, edges };
}
