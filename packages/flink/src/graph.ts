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
        .array(
          z.looseObject({
            num: z.number().optional(),
            id: z.coerce.string(),
            ship_strategy: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

export interface JobGraph {
  nodes: { id: string; name: string; parallelism: number; status: string }[];
  /** `num`: the input's index on its target, so two inputs from the same upstream (a self-join) stay apart. */
  edges: { from: string; to: string; ship: string | null; num: number }[];
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
          .map((i, k) => ({ from: i.id, to: n.id, ship: i.ship_strategy ?? null, num: i.num ?? k })),
      )
    : [];
  return { nodes, edges };
}

/**
 * The graph's columns, left to right (board D08): a node sits one column after its deepest input, so a join
 * waits for its longest branch. Within a column, vertex order. Relaxed at most n times, so even a cycle (not
 * possible in a job graph) ends.
 * ponytail: columns, not a full layout; a wide or crossing-heavy graph wants elkjs + @xyflow/react (the stack).
 */
export function graphLayers(g: JobGraph): string[][] {
  const depth = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < g.nodes.length; i++) {
    let moved = false;
    for (const e of g.edges) {
      const d = (depth.get(e.from) ?? 0) + 1;
      if (d > (depth.get(e.to) ?? 0) && d < g.nodes.length) {
        depth.set(e.to, d);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const layers: string[][] = [];
  for (const n of g.nodes) (layers[depth.get(n.id) ?? 0] ??= []).push(n.id);
  return layers.filter(Boolean);
}
