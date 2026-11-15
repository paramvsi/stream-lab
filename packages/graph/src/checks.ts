import { checkCel } from './cel';
import { spec } from './nodes';
import type { FieldType, Issue, PipelineNode, Schema, SchemaCtx } from './types';

/** "reasonField" → "Reason field", "ttlMs" → "TTL". Labels for NODE-REQUIRED. */
const LABELS: Record<string, string> = {
  expr: 'Expression',
  name: 'Name',
  reasonField: 'Reason field',
  routes: 'Routes',
  key: 'Key',
  as: 'Output name',
  field: 'Field',
  schema: 'Schema',
  steps: 'Steps',
  condition: 'Condition',
};
const label = (path: PropertyKey[]) => {
  const last = [...path].reverse().find((p) => typeof p === 'string') as string | undefined;
  if (!last) return 'This setting';
  return LABELS[last] ?? last.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
};

const dur = (ms: number) =>
  ms >= 3600000
    ? `${+(ms / 3600000).toFixed(1)} h`
    : ms >= 60000
      ? `${+(ms / 60000).toFixed(1)} min`
      : `${ms / 1000} s`;

const CEL_OF: Record<FieldType, 'string' | 'double' | 'bool' | 'google.protobuf.Timestamp'> = {
  string: 'string',
  number: 'double',
  boolean: 'bool',
  timestamp: 'google.protobuf.Timestamp',
};

export interface NodeCheckCtx extends SchemaCtx {
  /** Sources upstream of this node (for WIN-NO-TIME). */
  upstreamSources: PipelineNode[];
}

/**
 * Node-level checks (NODES.md "Validation (codes)"): required settings, CEL expressions against the input schema,
 * and each node's own rules. `inputs[port]` = schema per incoming edge.
 */
export function nodeIssues(n: PipelineNode, inputs: Record<string, Schema[]>, ctx: NodeCheckCtx): Issue[] {
  const s = spec(n.type);
  const cfg = { ...(s.defaults() as object), ...(n.config as object) } as Record<string, unknown>;
  const at = (i: Omit<Issue, 'nodeId'>): Issue => ({ ...i, nodeId: n.id });
  const out: Issue[] = [];

  // NODE-REQUIRED: empty text or list where the schema needs one (zod min(1)).
  const parsed = s.config.safeParse(cfg);
  if (!parsed.success)
    for (const i of parsed.error.issues) {
      const origin = (i as { origin?: string }).origin;
      if (i.code === 'too_small' && (origin === 'string' || origin === 'array'))
        out.push(at({ code: 'NODE-REQUIRED', params: { field: label(i.path) }, field: i.path.join('.') }));
    }
  const required = new Set(out.map((i) => i.field));

  const main = inputs['main']?.[0] ?? [];
  const cel = (
    expr: unknown,
    field: string,
    want?: Parameters<typeof checkCel>[2],
    schema: Schema = main,
  ) => {
    if (typeof expr !== 'string' || required.has(field)) return;
    if (!expr.trim())
      return void out.push(at({ code: 'NODE-REQUIRED', params: { field: 'Expression' }, field }));
    const p = checkCel(expr, schema, want);
    if (p) out.push(at({ ...p, field }));
  };

  switch (n.type) {
    case 'Filter':
      cel(cfg.expr, 'expr', 'bool');
      break;
    case 'Map':
      (cfg.assignments as { expr: string; type: FieldType }[]).forEach((a, i) =>
        cel(a.expr, `assignments.${i}.expr`, CEL_OF[a.type]),
      );
      break;
    case 'Validate':
      (cfg.rules as { expr: string }[]).forEach((r, i) => cel(r.expr, `rules.${i}.expr`, 'bool'));
      break;
    case 'Route': {
      (cfg.routes as { expr: string }[]).forEach((r, i) => cel(r.expr, `routes.${i}.expr`, 'bool'));
      // ponytail: overlap between rules is not analysed; only the missing default branch (catalog row says so).
      if (!cfg.defaultBranch) out.push(at({ code: 'ROUTE-OVERLAP', params: {}, field: 'defaultBranch' }));
      break;
    }
    case 'Window': {
      const size = cfg.sizeMs as number;
      const kind = cfg.kind as string;
      const slide = cfg.slideMs as number;
      if (size <= 0)
        out.push(
          at({
            code: 'WIN-SIZE',
            params: { reason: 'The window size must be more than 0' },
            field: 'sizeMs',
          }),
        );
      else if ((kind === 'hop' || kind === 'cumulate') && (slide <= 0 || slide > size))
        out.push(
          at({
            code: 'WIN-SIZE',
            params: {
              reason: `The ${kind === 'hop' ? 'slide' : 'step'} must be more than 0 and at most the window size`,
            },
            field: 'slideMs',
          }),
        );
      if (kind === 'session' && (cfg.gapMs as number) <= 0)
        out.push(
          at({ code: 'WIN-SIZE', params: { reason: 'The session gap must be more than 0' }, field: 'gapMs' }),
        );
      const lateness = cfg.allowedLatenessMs as number;
      if (size > 0 && lateness > size * 10)
        out.push(at({ code: 'WM-LATENESS-BIG', params: { x: dur(lateness) }, field: 'allowedLatenessMs' }));
      for (const src of ctx.upstreamSources)
        if (src.type === 'Source' && !String((src.config as { eventTime?: string }).eventTime ?? '').trim())
          out.push(
            at({ code: 'WIN-NO-TIME', params: { source: src.label?.trim() || src.type }, field: 'kind' }),
          );
      break;
    }
    case 'Lookup': {
      const table = String(cfg.table ?? '');
      const rows = ctx.refTables[table];
      if (table && (!rows || rows.length === 0))
        out.push(at({ code: 'LOOKUP-NO-TABLE', params: { t: table }, field: 'table' }));
      const a = main.find((f) => f.name === cfg.key);
      const b = rows?.find((f) => f.name === cfg.tableKey);
      if (a && b && a.type !== b.type)
        out.push(at({ code: 'LOOKUP-KEY-TYPE', params: { a: a.type, b: b.type }, field: 'key' }));
      break;
    }
    case 'Join':
      if (cfg.lowerMs == null || cfg.upperMs == null)
        out.push(at({ code: 'JOIN-NO-BOUND', params: {}, field: 'lowerMs' }));
      break;
    case 'Deduplicate':
      if (cfg.ttlMs == null) out.push(at({ code: 'DEDUP-NO-TTL', params: {}, field: 'ttlMs' }));
      break;
    case 'Pattern': {
      const steps = cfg.steps as { condition: string; min: number; max: number }[];
      if (!steps.length)
        out.push(
          at({ code: 'PATTERN-INVALID', params: { n: 1, reason: 'add at least one step' }, field: 'steps' }),
        );
      steps.forEach((st, i) => {
        if (!st.condition.trim())
          out.push(
            at({
              code: 'PATTERN-INVALID',
              params: { n: i + 1, reason: 'add a condition' },
              field: `steps.${i}.condition`,
            }),
          );
        else if (st.min > st.max)
          out.push(
            at({
              code: 'PATTERN-INVALID',
              params: { n: i + 1, reason: 'the times range is invalid' },
              field: `steps.${i}.min`,
            }),
          );
        else cel(st.condition, `steps.${i}.condition`, 'bool');
      });
      break;
    }
  }
  return out;
}
