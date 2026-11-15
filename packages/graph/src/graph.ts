import { CATALOG } from '@sl/errors/catalog';
import { spec } from './nodes';
import type { FieldType, Issue, PipelineEdge, PipelineNode, Schema, SchemaCtx } from './types';

export interface Graph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export const EMPTY_CTX: SchemaCtx = { refTables: {} };

/** Config with defaults filled in, so half-edited configs still propagate. */
export function configOf(n: PipelineNode): never {
  return { ...(spec(n.type).defaults() as object), ...(n.config as object) } as never;
}

export const labelOf = (n: PipelineNode) => n.label?.trim() || n.type;

export function inputsOf(n: PipelineNode) {
  return spec(n.type).inputs(configOf(n));
}
export function outputsOf(n: PipelineNode) {
  return spec(n.type).outputs(configOf(n));
}

/** Kahn order; nodes on a cycle are left out (imports reject cycles, the canvas refuses them). */
export function topoOrder(g: Graph): PipelineNode[] {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const queue = g.nodes.filter((n) => indeg.get(n.id) === 0);
  const out: PipelineNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const e of g.edges)
      if (e.source === n.id) {
        const d = indeg.get(e.target)! - 1;
        indeg.set(e.target, d);
        if (d === 0) queue.push(byId.get(e.target)!);
      }
  }
  return out;
}

export interface Schemas {
  /** Per node, per output port. */
  out: Map<string, Record<string, Schema>>;
  /** Per node, per input port: one schema per incoming edge. */
  in: Map<string, Record<string, Schema[]>>;
  /** Schema flowing on each edge (shown on edge hover, SIM-25). */
  edge: Map<string, Schema>;
}

/** Propagate schemas from sources along edges (NODES.md: each node declares outputSchema). */
export function propagate(g: Graph, ctx: SchemaCtx = EMPTY_CTX): Schemas {
  const s: Schemas = { out: new Map(), in: new Map(), edge: new Map() };
  for (const n of topoOrder(g)) {
    const ins: Record<string, Schema[]> = {};
    for (const e of g.edges)
      if (e.target === n.id) {
        const schema = s.out.get(e.source)?.[e.sourceHandle] ?? [];
        s.edge.set(e.id, schema);
        (ins[e.targetHandle] ??= []).push(schema);
      }
    s.in.set(n.id, ins);
    // A disabled node passes its first input straight through (Join: left).
    const firstIn = inputsOf(n)[0]?.id;
    const outs = n.disabled
      ? Object.fromEntries(outputsOf(n).map((p) => [p.id, (firstIn && ins[firstIn]?.[0]) || []]))
      : spec(n.type).outputSchema(ins, configOf(n), ctx);
    s.out.set(n.id, outs);
  }
  return s;
}

/** Does a field's type satisfy a requirement (one type or a list of acceptable types)? */
const typeOk = (t: FieldType, want: FieldType | FieldType[] | undefined) =>
  want === undefined || (Array.isArray(want) ? want.includes(t) : t === want);
/** "amount (number)", "event_time (number or timestamp)" or just "amount". */
const need = (r: { field: string; type?: FieldType | FieldType[] | undefined }) =>
  r.type ? `${r.field} (${Array.isArray(r.type) ? r.type.join(' or ') : r.type})` : r.field;

const names = (schema: Schema) => schema.map((f) => f.name).join(', ') || 'no fields';

function reaches(g: Graph, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of g.edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

export interface Connection {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/**
 * isValidConnection rules (SIMULATOR.md): self-loop, cycle, duplicate edge, port arity, schema mismatch.
 * Returns the reason to show at the cursor, or null when the edge may be created.
 */
export function connectionIssue(g: Graph, c: Connection, ctx: SchemaCtx = EMPTY_CTX): Issue | null {
  const src = g.nodes.find((n) => n.id === c.source);
  const tgt = g.nodes.find((n) => n.id === c.target);
  if (!src || !tgt) throw new Error(`connectionIssue: unknown node ${!src ? c.source : c.target}`);
  const inPort = inputsOf(tgt).find((p) => p.id === c.targetHandle);
  if (!outputsOf(src).some((p) => p.id === c.sourceHandle) || !inPort)
    throw new Error(`connectionIssue: unknown port ${c.sourceHandle} → ${c.targetHandle}`);

  if (c.source === c.target || reaches(g, c.target, c.source)) return { code: 'SIM-CYCLE', params: {} };
  if (
    g.edges.some(
      (e) =>
        e.source === c.source &&
        e.sourceHandle === c.sourceHandle &&
        e.target === c.target &&
        e.targetHandle === c.targetHandle,
    )
  )
    return { code: 'SIM-DUP-EDGE', params: {} };
  if (!inPort.multi && g.edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle))
    return { code: 'SIM-PORT-TAKEN', params: { port: inPort.label, node: labelOf(tgt) }, nodeId: tgt.id };

  const has = propagate(g, ctx).out.get(src.id)?.[c.sourceHandle] ?? [];
  // Nothing known upstream yet (e.g. an unconnected Filter), or a disabled target (it passes events through
  // untouched, as validate() treats it): accept; validation re-checks later.
  if (has.length === 0 || tgt.disabled) return null;
  const missing = spec(tgt.type)
    .requires(configOf(tgt))
    .filter((r) => r.port === c.targetHandle)
    .filter((r) => {
      const f = has.find((x) => x.name === r.field);
      return !f || !typeOk(f.type, r.type);
    })
    .map((r) => need(r));
  if (missing.length)
    return {
      code: 'SIM-PORT-TYPE',
      params: { a: labelOf(src), has: names(has), b: labelOf(tgt), needs: missing.join(', ') },
      nodeId: tgt.id,
    };
  return null;
}

const sameSchema = (a: Schema, b: Schema) =>
  a.length === b.length && a.every((f) => b.some((g) => g.name === f.name && g.type === f.type));

/** Graph-level checks (NODES.md): run on every change. */
export function validate(g: Graph, ctx: SchemaCtx = EMPTY_CTX): Issue[] {
  const issues: Issue[] = [];
  const s = propagate(g, ctx);
  const isSource = (n: PipelineNode) => spec(n.type).category === 'Sources';
  if (!g.nodes.some((n) => isSource(n) && !n.disabled)) issues.push({ code: 'SIM-NO-SOURCE', params: {} });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  for (const n of g.nodes) {
    const node = labelOf(n);
    const ins = s.in.get(n.id) ?? {};
    const ports = inputsOf(n);
    const open = ports.filter((p) => !ins[p.id]?.length);
    // A node with several inputs (Join) names the one that is missing.
    if (open.length)
      issues.push({
        code: 'SIM-DISCONNECTED',
        params: { node: ports.length > 1 && open.length === 1 ? `${node} (${open[0]!.label})` : node },
        nodeId: n.id,
      });

    const mainOuts = outputsOf(n).filter((p) => p.kind === 'main');
    if (mainOuts.some((p) => !g.edges.some((e) => e.source === n.id && e.sourceHandle === p.id)))
      issues.push({ code: 'SIM-NO-SINK', params: { node }, nodeId: n.id });

    const drifted = new Set<string>();
    if (!n.disabled)
      for (const r of spec(n.type).requires(configOf(n))) {
        const edge = g.edges.find((e) => e.target === n.id && e.targetHandle === r.port);
        const schema = edge ? s.edge.get(edge.id) : undefined;
        // One row per (port, field), however many rules read it.
        const key = `${r.port}:${r.field}`;
        // Missing, or still there but with a type this node can't use (e.g. amount became text).
        const f = schema?.find((x) => x.name === r.field);
        if (
          edge &&
          schema?.length &&
          (!f || !typeOk(f.type, r.type)) &&
          !drifted.has(key) &&
          drifted.add(key)
        )
          issues.push({
            code: 'SIM-SCHEMA-DRIFT',
            params: { node, field: f ? need(r) : r.field, upstream: labelOf(byId.get(edge.source)!) },
            nodeId: n.id,
          });
      }

    if (n.type === 'Union') {
      const edges = g.edges.filter((e) => e.target === n.id);
      const first = edges[0];
      const odd = edges.find((e) => !sameSchema(s.edge.get(e.id) ?? [], s.edge.get(first!.id) ?? []));
      if (first && odd)
        issues.push({
          code: 'SIM-UNION-SCHEMA',
          params: {
            a: labelOf(byId.get(first.source)!),
            x: names(s.edge.get(first.id) ?? []),
            b: labelOf(byId.get(odd.source)!),
            y: names(s.edge.get(odd.id) ?? []),
          },
          nodeId: n.id,
        });
    }
  }
  return issues;
}

export const severityOf = (i: Issue) => CATALOG[i.code].severity;

/** SIM-RUN-BLOCKED: errors block Run, warnings do not. */
export function runBlocker(issues: Issue[]): Issue | null {
  const n = issues.filter((i) => severityOf(i) === 'error').length;
  return n ? { code: 'SIM-RUN-BLOCKED', params: { n } } : null;
}
