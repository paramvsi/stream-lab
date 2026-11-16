import { parse } from '@marcbachmann/cel-js';
import { configOf, EMPTY_CTX, labelOf, propagate, topoOrder, type Graph } from './graph';
import type { FieldType, NodeType, PipelineNode, Schema, SchemaCtx } from './types';

/**
 * EXP-01 Flink SQL export (board W17). Each node becomes a temporary view, sources and sinks become tables, and
 * the sinks are filled by INSERT INTO (one statement set when there are several). What has no direct SQL becomes
 * a TODO comment and is listed (EXPORT-UNSUPPORTED); nothing is guessed. Connector options are placeholders.
 * FLINK: syntax per https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql/overview/ ,
 * unchanged in 2.0–2.2 for what is generated here.
 */

const q = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const str = (s: string) => `'${s.replace(/'/g, "''")}'`;
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Ast = { op: string; args: unknown };
const BIN: Record<string, string> = {
  '&&': 'AND',
  '||': 'OR',
  '==': '=',
  '!=': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
};

/** CEL → Flink SQL for the plain subset; null for anything else (the caller marks the node unsupported). */
export function celToSql(expr: string): string | null {
  let ast: Ast;
  try {
    const r = parse(expr) as unknown as { ast?: Ast };
    ast = (r.ast ?? r) as Ast;
  } catch {
    return null; // a parse error is CEL-PARSE on the node; the export does not guess
  }
  const lit = (v: unknown): string | null =>
    v === null
      ? 'NULL'
      : typeof v === 'string'
        ? str(v)
        : typeof v === 'boolean'
          ? v
            ? 'TRUE'
            : 'FALSE'
          : typeof v === 'number' || typeof v === 'bigint'
            ? String(v)
            : null;
  const isNull = (a: Ast) => a.op === 'value' && a.args === null;
  const go = (a: Ast): string | null | undefined => {
    const args = a.args as Ast[];
    if (a.op === 'value') return lit(a.args) ?? null;
    switch (a.op) {
      case 'id':
        return q(String(a.args));
      case 'value':
        return lit(a.args) ?? null;
      case '!_': {
        const x = go(a.args as Ast);
        return x && `NOT (${x})`;
      }
      case '-_': {
        const x = go(a.args as Ast);
        return x && `-${x}`;
      }
      case '%': {
        const [l, r] = [go(args[0]!), go(args[1]!)];
        return l && r && `MOD(${l}, ${r})`;
      }
      case '?:': {
        const [c, t, e] = args.map(go);
        return c && t && e && `CASE WHEN ${c} THEN ${t} ELSE ${e} END`;
      }
      case 'in': {
        const list = args[1]!;
        if (list.op !== 'list') return null;
        const l = go(args[0]!);
        const items = (list.args as Ast[]).map(go);
        return l && items.every(Boolean) ? `${l} IN (${items.join(', ')})` : null;
      }
      case 'call': {
        const [fn, xs] = a.args as [string, Ast[]];
        if (fn !== 'size' || xs.length !== 1) return null;
        const x = go(xs[0]!);
        return x && `CHAR_LENGTH(${x})`;
      }
      case 'rcall': {
        const [fn, target, xs] = a.args as [string, Ast, Ast[]];
        const arg = xs[0];
        if (xs.length !== 1 || arg?.op !== 'value' || typeof arg.args !== 'string') return null;
        const t = go(target);
        const s = like(arg.args);
        const pat =
          fn === 'startsWith' ? `${s}%` : fn === 'endsWith' ? `%${s}` : fn === 'contains' ? `%${s}%` : null;
        return t && pat && `${t} LIKE ${str(pat)} ESCAPE '\\'`;
      }
      default: {
        const op = BIN[a.op];
        if (!op || !Array.isArray(args) || args.length !== 2) return null;
        if ((a.op === '==' || a.op === '!=') && (isNull(args[0]!) || isNull(args[1]!))) {
          const other = go(isNull(args[0]!) ? args[1]! : args[0]!);
          return other && `${other} IS ${a.op === '==' ? '' : 'NOT '}NULL`;
        }
        const [l, r] = [go(args[0]!), go(args[1]!)];
        if (!l || !r) return null;
        return op === 'AND' || op === 'OR' ? `(${l} ${op} ${r})` : `${l} ${op} ${r}`;
      }
    }
  };
  return go(ast) ?? null;
}

const SQL_TYPE: Record<FieldType, string> = {
  string: 'STRING',
  number: 'DOUBLE',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP(3)',
};
const columns = (s: Schema) =>
  s.map((f) => `  ${q(f.name)} ${SQL_TYPE[f.type]}${f.required ? ' NOT NULL' : ''}`);
const secs = (ms: number) => `INTERVAL '${Math.max(0, Math.round(ms / 1000))}' SECOND`;
const KAFKA = (topic: string) =>
  `WITH (\n  'connector' = 'kafka',\n  'topic' = ${str(topic)},\n  'properties.bootstrap.servers' = 'localhost:9092',\n  'format' = 'json'\n)`;

export interface SqlExport {
  sql: string;
  /** EXPORT-UNSUPPORTED: nodes exported as a TODO comment. */
  unsupported: { id: string; label: string; type: NodeType }[];
}

/** Export a pipeline as Flink SQL. `ctx`: the reference tables Lookups use (schemas only). */
export function toFlinkSql(g: Graph, ctx: SchemaCtx = EMPTY_CTX): SqlExport {
  const s = propagate(g, ctx);
  const order = topoOrder(g);
  const taken = new Set<string>();
  const nameOf = new Map<string, string>();
  const unique = (base: string) => {
    let n =
      base
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'node';
    if (/^\d/.test(n)) n = `n_${n}`;
    let u = n;
    for (let i = 2; taken.has(u); i++) u = `${n}_${i}`;
    taken.add(u);
    return u;
  };
  // Tables named by their config (topic), views by their label.
  for (const n of order) {
    const c = configOf(n) as Record<string, unknown>;
    const base =
      n.type === 'Source' || n.type === 'Sink' ? String(c['name'] || labelOf(n)) : n.label?.trim() || n.id;
    nameOf.set(n.id, unique(base));
  }
  /** The view (or table) a node's output port reads as. */
  const outName = (id: string, port: string) => {
    const base = nameOf.get(id)!;
    return port === 'main' ? base : `${base}_${port.replace(/^route-/, '')}`;
  };
  const inputs = (n: PipelineNode) =>
    g.edges.filter((e) => e.target === n.id).map((e) => ({ e, from: outName(e.source, e.sourceHandle) }));
  const inSchema = (n: PipelineNode, port = 'main') => s.in.get(n.id)?.[port]?.[0] ?? [];

  const parts: string[] = [];
  const inserts: string[] = [];
  const unsupported: SqlExport['unsupported'] = [];
  const view = (name: string, body: string) => parts.push(`CREATE TEMPORARY VIEW ${q(name)} AS\n${body};`);
  const todo = (n: PipelineNode, why: string) => {
    unsupported.push({ id: n.id, label: labelOf(n), type: n.type });
    const from = inputs(n)[0]?.from;
    parts.push(
      `-- TODO (EXPORT-UNSUPPORTED): ${labelOf(n)} (${n.type}) — ${why}\n` +
        (from ? `CREATE TEMPORARY VIEW ${q(nameOf.get(n.id)!)} AS\nSELECT * FROM ${q(from)};` : ''),
    );
  };

  for (const n of order) {
    const c = configOf(n) as Record<string, unknown>;
    const me = nameOf.get(n.id)!;
    const from = inputs(n)[0]?.from;
    if (n.disabled) {
      // A disabled node passes its main input through (as the simulator does).
      if (from) view(me, `SELECT * FROM ${q(from)}`);
      continue;
    }
    switch (n.type) {
      case 'Source': {
        const schema = s.out.get(n.id)?.['main'] ?? [];
        const t = String(c['eventTime'] || '');
        const wm = schema.some((f) => f.name === t && f.type === 'timestamp')
          ? `,\n  WATERMARK FOR ${q(t)} AS ${q(t)} - ${secs(Number(c['outOfOrdernessMs'] ?? 0))}`
          : '';
        parts.push(`CREATE TABLE ${q(me)} (\n${columns(schema).join(',\n')}${wm}\n) ${KAFKA(me)};`);
        break;
      }
      case 'Generator': {
        const schema = s.out.get(n.id)?.['main'] ?? [];
        // FLINK: datagen connector, https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/connectors/table/datagen/
        parts.push(
          `CREATE TABLE ${q(me)} (\n${columns(schema).join(',\n')},\n  WATERMARK FOR ${q('event_time')} AS ${q('event_time')} - INTERVAL '5' SECOND\n) WITH (\n  'connector' = 'datagen',\n  'rows-per-second' = '${Number(c['rate'] ?? 50)}',\n  'number-of-rows' = '${Number(c['count'] ?? 1000)}'\n);`,
        );
        break;
      }
      case 'Filter': {
        const w = celToSql(String(c['expr'] ?? ''));
        if (!w || !from) todo(n, `its expression has no direct SQL: ${String(c['expr'] ?? '')}`);
        else view(me, `SELECT * FROM ${q(from)}\nWHERE ${w}`);
        break;
      }
      case 'Map': {
        const as = (c['assignments'] ?? []) as { field: string; expr: string; type: FieldType }[];
        const drop = new Set([...((c['drop'] ?? []) as string[]), ...as.map((a) => a.field)]);
        const exprs = as.map((a) => ({ a, sql: celToSql(a.expr) }));
        if (!from || exprs.some((x) => !x.sql)) {
          todo(n, `an expression has no direct SQL: ${exprs.find((x) => !x.sql)?.a.expr ?? ''}`);
          break;
        }
        const cols = [
          ...inSchema(n)
            .filter((f) => !drop.has(f.name))
            .map((f) => q(f.name)),
          ...exprs.map(({ a, sql }) => `CAST(${sql} AS ${SQL_TYPE[a.type]}) AS ${q(a.field)}`),
        ];
        view(me, `SELECT ${cols.join(', ')}\nFROM ${q(from)}`);
        break;
      }
      case 'Validate': {
        const rules = ((c['rules'] ?? []) as { name: string; expr: string; severity: string }[]).filter(
          (r) => r.severity === 'error',
        );
        const sqls = rules.map((r) => ({ r, sql: celToSql(r.expr) }));
        if (!from || sqls.some((x) => !x.sql)) {
          todo(n, `a rule has no direct SQL: ${sqls.find((x) => !x.sql)?.r.expr ?? ''}`);
          break;
        }
        const ok = sqls.map((x) => x.sql).join(' AND ') || 'TRUE';
        view(me, `SELECT * FROM ${q(from)}\nWHERE ${ok}`);
        // Rejected rows say which rule failed first (the simulator's dead-letter reason).
        const reason = sqls.length
          ? `CASE ${sqls.map((x) => `WHEN NOT (${x.sql}) THEN ${str(x.r.name)}`).join(' ')} END`
          : 'CAST(NULL AS STRING)';
        if (g.edges.some((e) => e.source === n.id && e.sourceHandle === 'rejected'))
          view(
            outName(n.id, 'rejected'),
            sqls.length === 1
              ? `SELECT *, ${str(sqls[0]!.r.name)} AS ${q('reason')} FROM ${q(from)}\nWHERE NOT (${ok})`
              : `SELECT *, ${reason} AS ${q('reason')} FROM ${q(from)}\nWHERE NOT (${ok})`,
          );
        break;
      }
      case 'Route': {
        const routes = (c['routes'] ?? []) as { id: string; name: string; expr: string }[];
        const sqls = routes.map((r) => ({ r, sql: celToSql(r.expr) }));
        if (!from || sqls.some((x) => !x.sql)) {
          todo(n, `a route has no direct SQL: ${sqls.find((x) => !x.sql)?.r.expr ?? ''}`);
          break;
        }
        // FLINK: SQL has no first-match routing; each branch excludes the earlier ones, as the simulator routes.
        sqls.forEach((x, i) => {
          const before = sqls.slice(0, i).map((y) => `NOT (${y.sql})`);
          view(
            outName(n.id, `route-${x.r.id}`),
            `SELECT * FROM ${q(from)}\nWHERE ${[...before, x.sql].join(' AND ')}`,
          );
        });
        if (c['defaultBranch'])
          view(
            outName(n.id, 'default'),
            `SELECT * FROM ${q(from)}\nWHERE ${sqls.map((x) => `NOT (${x.sql})`).join(' AND ') || 'TRUE'}`,
          );
        break;
      }
      case 'Union': {
        const tag = String(c['tagField'] ?? '');
        const ins = inputs(n);
        if (!ins.length) break;
        const label = (id: string) => labelOf(g.nodes.find((x) => x.id === id)!);
        view(
          me,
          ins
            .map((i) => `SELECT *${tag ? `, ${str(label(i.e.source))} AS ${q(tag)}` : ''} FROM ${q(i.from)}`)
            .join('\nUNION ALL\n'),
        );
        break;
      }
      case 'Sink': {
        const schema = inSchema(n);
        parts.push(`CREATE TABLE ${q(me)} (\n${columns(schema).join(',\n')}\n) ${KAFKA(me)};`);
        for (const i of inputs(n)) inserts.push(`INSERT INTO ${q(me)}\nSELECT * FROM ${q(i.from)};`);
        break;
      }
      case 'Dead-letter': {
        // Each input has its own columns, so each gets its own table (SQL tables have one schema).
        for (const i of inputs(n)) {
          const t = unique(`${me}_${i.from}`);
          const schema = s.out.get(i.e.source)?.[i.e.sourceHandle] ?? [];
          parts.push(`CREATE TABLE ${q(t)} (\n${columns(schema).join(',\n')}\n) ${KAFKA(t)};`);
          inserts.push(`INSERT INTO ${q(t)}\nSELECT * FROM ${q(i.from)};`);
        }
        break;
      }
      default:
        // ponytail: windows, joins, lookups, dedup, top-N and pattern are the next slice.
        todo(n, 'not exported yet');
    }
  }
  const run =
    inserts.length > 1
      ? // FLINK: statement sets, https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql/insert/
        `EXECUTE STATEMENT SET\nBEGIN\n${inserts.join('\n')}\nEND;`
      : inserts.join('\n');
  const head = '-- Generated by Stream Lab for Flink 1.20 and 2.x. Connector options are placeholders.';
  return { sql: [head, ...parts, run].filter(Boolean).join('\n\n') + '\n', unsupported };
}
