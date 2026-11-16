import { parse } from '@marcbachmann/cel-js';
import { configOf, EMPTY_CTX, labelOf, propagate, topoOrder, type Graph } from './graph';
import { spec } from './nodes';
import type { FieldType, NodeType, PipelineNode, Schema, SchemaCtx } from './types';

/**
 * EXP-01 Flink SQL export (board W17). Each node becomes a temporary view, sources and sinks become tables, and
 * the sinks are filled by INSERT INTO (one statement set when there are several). What has no direct SQL becomes
 * a TODO comment and is listed (EXPORT-UNSUPPORTED); statements that read it are left out as comments, so nothing
 * is guessed. Connector options are placeholders.
 * FLINK: syntax per https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql/overview/ ,
 * unchanged in 2.0–2.2 for what is generated here.
 */

const q = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const str = (s: string) => `'${s.replace(/'/g, "''")}'`;

type Ast = { op: string; args: unknown };
type T = 'string' | 'number' | 'bool' | 'time' | null;
const BIN: Record<string, string> = {
  '&&': 'AND',
  '||': 'OR',
  '==': '=',
  '!=': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '-': '-',
  '*': '*',
  '/': '/',
};
const COMPARE = new Set(['&&', '||', '==', '!=', '<', '<=', '>', '>=', 'in']);

/**
 * CEL → Flink SQL for the plain subset; null for anything else (the caller marks the node unsupported). Every
 * operation is parenthesised, so CEL's grouping survives. `schema` gives field types, so `+` on strings becomes
 * `||` (SQL concatenation); a `+` whose operand types are unknown is not translated.
 */
export function celToSql(expr: string, schema: Schema = []): string | null {
  let ast: Ast;
  try {
    const r = parse(expr) as unknown as { ast?: Ast };
    ast = (r.ast ?? r) as Ast;
  } catch {
    return null; // a parse error is CEL-PARSE on the node; the export does not guess
  }
  const fieldType = new Map(schema.map((f) => [f.name, f.type]));
  const typeOf = (a: Ast): T => {
    if (a.op === 'value')
      return typeof a.args === 'string'
        ? 'string'
        : typeof a.args === 'number' || typeof a.args === 'bigint'
          ? 'number'
          : typeof a.args === 'boolean'
            ? 'bool'
            : null;
    if (a.op === 'id') {
      const t = fieldType.get(String(a.args));
      return t === 'string'
        ? 'string'
        : t === 'number'
          ? 'number'
          : t === 'boolean'
            ? 'bool'
            : t === 'timestamp'
              ? 'time'
              : null;
    }
    if (COMPARE.has(a.op) || a.op === '!_') return 'bool';
    if (a.op === '+') {
      const [l, r] = (a.args as Ast[]).map(typeOf);
      return l === 'string' || r === 'string' ? 'string' : l === 'number' && r === 'number' ? 'number' : null;
    }
    if (['-', '*', '/', '%', '-_'].includes(a.op) || (a.op === 'call' && (a.args as [string])[0] === 'size'))
      return 'number';
    return null;
  };
  const lit = (v: unknown): string | null =>
    v === null
      ? 'NULL'
      : typeof v === 'string'
        ? str(v)
        : typeof v === 'boolean'
          ? v
            ? 'TRUE'
            : 'FALSE'
          : typeof v === 'bigint'
            ? String(v)
            : typeof v === 'number' && Number.isFinite(v)
              ? // A CEL double stays a decimal in SQL (7.0 / 2.0 is 3.5, not integer division).
                Number.isInteger(v)
                ? `${v}.0`
                : String(v)
              : null;
  const isNull = (a: Ast) => a.op === 'value' && a.args === null;
  const go = (a: Ast): string | null | undefined => {
    const args = a.args as Ast[];
    switch (a.op) {
      case 'id':
        return q(String(a.args));
      case 'value':
        return lit(a.args);
      case '!_': {
        const x = go(a.args as Ast);
        return x && `(NOT ${x})`;
      }
      case '-_': {
        const x = go(a.args as Ast);
        return x && `(-${x})`; // never "--", which starts a SQL comment
      }
      case '%': {
        const [l, r] = [go(args[0]!), go(args[1]!)];
        return l && r && `MOD(${l}, ${r})`;
      }
      case '+': {
        const [l, r] = [go(args[0]!), go(args[1]!)];
        const t = typeOf(a);
        if (!l || !r || !t) return null;
        return t === 'string' ? `(${l} || ${r})` : `(${l} + ${r})`;
      }
      case '?:': {
        const [c, t, e] = args.map(go);
        return c && t && e && `(CASE WHEN ${c} THEN ${t} ELSE ${e} END)`;
      }
      case 'in': {
        const list = args[1]!;
        if (list.op !== 'list') return null;
        const l = go(args[0]!);
        const items = (list.args as Ast[]).map(go);
        return l && items.every(Boolean) ? `(${l} IN (${items.join(', ')}))` : null;
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
        // FLINK: LIKE has no ESCAPE support in 1.20 ("The escape character has not been supported yet"), so a
        // literal with % or _ can not be matched exactly: not translated.
        if (/[%_\\]/.test(arg.args)) return null;
        const t = go(target);
        const pat =
          fn === 'startsWith'
            ? `${arg.args}%`
            : fn === 'endsWith'
              ? `%${arg.args}`
              : fn === 'contains'
                ? `%${arg.args}%`
                : null;
        return t && pat && `(${t} LIKE ${str(pat)})`;
      }
      default: {
        const op = BIN[a.op];
        if (!op || !Array.isArray(args) || args.length !== 2) return null;
        if ((a.op === '==' || a.op === '!=') && (isNull(args[0]!) || isNull(args[1]!))) {
          const other = go(isNull(args[0]!) ? args[1]! : args[0]!);
          return other && `(${other} IS ${a.op === '==' ? '' : 'NOT '}NULL)`;
        }
        const [l, r] = [go(args[0]!), go(args[1]!)];
        return l && r && `(${l} ${op} ${r})`;
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
// No NOT NULL: generated and uploaded data has malformed rows (the simulator sends them on), and Flink's not-null
// enforcer would stop the job on the first one.
const columns = (s: Schema) => s.map((f) => `  ${q(f.name)} ${SQL_TYPE[f.type]}`);
/** A duration as a Flink interval literal (sign left to the caller). */
const ival = (ms: number) => {
  const a = Math.abs(ms);
  return a % 60000 === 0 && a
    ? `INTERVAL '${a / 60000}' MINUTE`
    : a % 1000 === 0
      ? `INTERVAL '${a / 1000}' SECOND`
      : `INTERVAL '${(a / 1000).toFixed(3)}' SECOND`;
};
const plus = (t: string, ms: number) => (ms === 0 ? t : `${t} ${ms < 0 ? '-' : '+'} ${ival(ms)}`);
const AGG: Record<string, string> = { count: 'COUNT', sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' };
// FLINK: Stream Lab times are ISO-8601 ("2026-11-15T12:00:39.980Z"); the json format reads 'SQL' style by default.
// https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/connectors/table/formats/json/
const KAFKA = (topic: string) =>
  `WITH (\n  'connector' = 'kafka',\n  'topic' = ${str(topic)},\n  'properties.bootstrap.servers' = 'localhost:9092',\n  'format' = 'json',\n  'json.timestamp-format.standard' = 'ISO-8601'\n)`;
/** Where a SQL condition holds; NULL (a malformed row) counts as not holding, as a failed rule does. */
const holds = (c: string) => `${c} IS TRUE`;
const fails = (c: string) => `${c} IS NOT TRUE`;

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
  const unique = (base: string, keep = false) => {
    let n = keep
      ? base
      : base
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'node';
    if (!keep && /^\d/.test(n)) n = `n_${n}`;
    let u = n;
    for (let i = 2; taken.has(u); i++) u = `${n}_${i}`;
    taken.add(u);
    return u;
  };
  // Tables keep their configured name exactly (it is the topic too); they are named first, so a view never takes
  // a table's name. Views are named from labels, and every output port gets its own unique name.
  const nameOf = new Map<string, string>();
  const topicOf = new Map<string, string>();
  for (const n of order)
    if (n.type === 'Source' || n.type === 'Sink') {
      const name = String((configOf(n) as Record<string, unknown>)['name'] || labelOf(n));
      topicOf.set(n.id, name);
      nameOf.set(n.id, unique(name, true));
    }
  for (const n of order) if (!nameOf.has(n.id)) nameOf.set(n.id, unique(n.label?.trim() || n.id));
  const portName = new Map<string, string>();
  const outName = (id: string, port: string) => {
    if (port === 'main') return nameOf.get(id)!;
    const k = `${id}\u0000${port}`;
    if (!portName.has(k)) portName.set(k, unique(`${nameOf.get(id)!}_${port.replace(/^route-/, '')}`));
    return portName.get(k)!;
  };
  const inputs = (n: PipelineNode) =>
    g.edges.filter((e) => e.target === n.id).map((e) => ({ e, from: outName(e.source, e.sourceHandle) }));
  const inSchema = (n: PipelineNode, port = 'main') => s.in.get(n.id)?.[port]?.[0] ?? [];
  const outSchema = (n: PipelineNode, port = 'main') => s.out.get(n.id)?.[port] ?? [];
  const list = (sch: Schema, prefix = '') => sch.map((f) => `${prefix}${q(f.name)}`).join(', ');
  const outPorts = (n: PipelineNode) => [
    ...new Set(['main', ...g.edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle)]),
  ];
  // The time attribute each view carries (rowtime), for windows, dedup, joins and as-of lookups.
  const rt = new Map<string, string | null>();
  // Views with no SQL (a TODO, or reading one): statements that read them are left out as comments.
  const tainted = new Set<string>();
  // What a side output says about its rows, for Dead-letter's reason field (the simulator's reasons).
  const reasons = new Map<string, string>();
  const refDone = new Set<string>();

  const parts: string[] = [];
  const inserts: string[] = [];
  const unsupported: SqlExport['unsupported'] = [];
  const view = (name: string, body: string) => parts.push(`CREATE TEMPORARY VIEW ${q(name)} AS\n${body};`);
  const taintOut = (n: PipelineNode) => outPorts(n).forEach((p) => tainted.add(outName(n.id, p)));
  const todo = (n: PipelineNode, why: string) => {
    unsupported.push({ id: n.id, label: labelOf(n), type: n.type });
    parts.push(`-- TODO (EXPORT-UNSUPPORTED): ${labelOf(n)} (${n.type}) — ${why}`);
    taintOut(n);
  };
  const edgesFrom = (n: PipelineNode, port: string) =>
    g.edges.some((e) => e.source === n.id && e.sourceHandle === port);

  for (const n of order) {
    const c = configOf(n) as Record<string, unknown>;
    const me = nameOf.get(n.id)!;
    const ins = inputs(n);
    const from = ins[0]?.from;
    const time = from ? (rt.get(from) ?? null) : null;
    const blocked = ins.find((i) => tainted.has(i.from));
    // (Dead-letter takes its inputs one by one: one with no SQL does not drop the others.)
    if (blocked && n.type !== 'Dead-letter') {
      parts.push(`-- Left out: ${labelOf(n)} reads ${blocked.from}, which has no SQL (see the TODO above).`);
      taintOut(n);
      continue;
    }
    if (n.disabled) {
      if (n.type === 'Source' || n.type === 'Generator' || !from) {
        parts.push(`-- Left out: ${labelOf(n)} is disabled and emits nothing.`);
        taintOut(n);
        continue;
      }
      // A disabled node passes its first input to its first output (as the simulator does); others are empty.
      const first = spec(n.type).outputs(c as never)[0]?.id ?? 'main';
      view(outName(n.id, first), `SELECT * FROM ${q(from)}`);
      rt.set(outName(n.id, first), time);
      for (const p of outPorts(n))
        if (p !== first) {
          parts.push(`-- Left out: ${labelOf(n)} is disabled; its ${p} output is empty.`);
          tainted.add(outName(n.id, p));
        }
      continue;
    }
    switch (n.type) {
      case 'Source': {
        const schema = outSchema(n);
        const t = String(c['eventTime'] || '');
        const wm = schema.some((f) => f.name === t && f.type === 'timestamp')
          ? `,\n  WATERMARK FOR ${q(t)} AS ${q(t)} - ${ival(Number(c['outOfOrdernessMs'] ?? 0))}`
          : '';
        parts.push(
          `CREATE TABLE ${q(me)} (\n${columns(schema).join(',\n')}${wm}\n) ${KAFKA(topicOf.get(n.id)!)};`,
        );
        rt.set(me, wm ? t : null);
        break;
      }
      case 'Generator': {
        const schema = outSchema(n);
        // FLINK: datagen connector, https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/connectors/table/datagen/
        parts.push(
          `CREATE TABLE ${q(me)} (\n${columns(schema).join(',\n')},\n  WATERMARK FOR ${q('event_time')} AS ${q('event_time')} - INTERVAL '5' SECOND\n) WITH (\n  'connector' = 'datagen',\n  'rows-per-second' = '${Number(c['rate'] ?? 50)}',\n  'number-of-rows' = '${Number(c['count'] ?? 1000)}'\n);`,
        );
        rt.set(me, 'event_time');
        break;
      }
      case 'Filter': {
        const w = from && celToSql(String(c['expr'] ?? ''), inSchema(n));
        if (!w || !from) {
          todo(n, `its expression has no direct SQL: ${String(c['expr'] ?? '')}`);
          break;
        }
        view(me, `SELECT * FROM ${q(from)}\nWHERE ${holds(w)}`);
        if (edgesFrom(n, 'rejected')) {
          const r = outName(n.id, 'rejected');
          view(r, `SELECT * FROM ${q(from)}\nWHERE ${fails(w)}`);
          reasons.set(r, str('filtered out'));
        }
        break;
      }
      case 'Map': {
        const as = (c['assignments'] ?? []) as { field: string; expr: string; type: FieldType }[];
        const drop = new Set([...((c['drop'] ?? []) as string[]), ...as.map((a) => a.field)]);
        const exprs = as.map((a) => ({ a, sql: celToSql(a.expr, inSchema(n)) }));
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
        // A dropped or recomputed time column is no longer a time attribute.
        rt.set(me, time && !drop.has(time) ? time : null);
        break;
      }
      case 'Validate': {
        // Every rule rejects, whatever its severity: the simulator does (MORNING D37 decides warnings).
        const rules = (c['rules'] ?? []) as { name: string; expr: string; severity: string }[];
        const sqls = rules.map((r) => ({ r, sql: celToSql(r.expr, inSchema(n)) }));
        if (!from || sqls.some((x) => !x.sql)) {
          todo(n, `a rule has no direct SQL: ${sqls.find((x) => !x.sql)?.r.expr ?? ''}`);
          break;
        }
        const ok = sqls.map((x) => holds(x.sql!)).join(' AND ') || 'TRUE';
        view(me, `SELECT * FROM ${q(from)}\nWHERE ${ok}`);
        if (edgesFrom(n, 'rejected')) {
          const r = outName(n.id, 'rejected');
          view(r, `SELECT * FROM ${q(from)}\nWHERE NOT (${ok})`);
          // The first rule that fails, as the simulator's reason.
          reasons.set(
            r,
            sqls.length
              ? `CASE ${sqls.map((x) => `WHEN ${fails(x.sql!)} THEN ${str(x.r.name)}`).join(' ')} END`
              : 'CAST(NULL AS STRING)',
          );
        }
        break;
      }
      case 'Route': {
        const routes = (c['routes'] ?? []) as { id: string; name: string; expr: string }[];
        const sqls = routes.map((r) => ({ r, sql: celToSql(r.expr, inSchema(n)) }));
        if (!from || sqls.some((x) => !x.sql)) {
          todo(n, `a route has no direct SQL: ${sqls.find((x) => !x.sql)?.r.expr ?? ''}`);
          break;
        }
        // FLINK: SQL has no first-match routing; each branch excludes the earlier ones, as the simulator routes.
        sqls.forEach((x, i) => {
          const before = sqls.slice(0, i).map((y) => fails(y.sql!));
          view(
            outName(n.id, `route-${x.r.id}`),
            `SELECT * FROM ${q(from)}\nWHERE ${[...before, holds(x.sql!)].join(' AND ')}`,
          );
        });
        if (c['defaultBranch'])
          view(
            outName(n.id, 'default'),
            `SELECT * FROM ${q(from)}\nWHERE ${sqls.map((x) => fails(x.sql!)).join(' AND ') || 'TRUE'}`,
          );
        break;
      }
      case 'Union': {
        const tag = String(c['tagField'] ?? '');
        if (!ins.length) break;
        const label = (id: string) => labelOf(g.nodes.find((x) => x.id === id)!);
        view(
          me,
          ins
            .map((i) => {
              // A tag named like an existing column replaces it (one column, as the schema has).
              const cols = (s.out.get(i.e.source)?.[i.e.sourceHandle] ?? []).filter((f) => f.name !== tag);
              return `SELECT ${list(cols)}${tag ? `, ${str(label(i.e.source))} AS ${q(tag)}` : ''} FROM ${q(i.from)}`;
            })
            .join('\nUNION ALL\n'),
        );
        break;
      }
      case 'Sink': {
        if (!ins.length) {
          parts.push(`-- Left out: ${labelOf(n)} has no input.`);
          break;
        }
        const schema = inSchema(n);
        parts.push(
          `CREATE TABLE ${q(me)} (\n${columns(schema).join(',\n')}\n) ${KAFKA(topicOf.get(n.id)!)};`,
        );
        // Explicit columns: views may carry extra time columns (window_time, proc_time).
        for (const i of ins) inserts.push(`INSERT INTO ${q(me)}\nSELECT ${list(schema)} FROM ${q(i.from)};`);
        break;
      }
      case 'Dead-letter': {
        // Each input has its own columns, so each gets its own table (SQL tables have one schema), plus the
        // configured reason field, filled with the simulator's reason for that output.
        const rf = String(c['reasonField'] || 'reason');
        for (const i of ins) {
          if (tainted.has(i.from)) {
            parts.push(`-- Left out: ${labelOf(n)} input ${i.from}, which has no SQL.`);
            continue;
          }
          const t = unique(`${me}_${i.from}`);
          const schema = (s.out.get(i.e.source)?.[i.e.sourceHandle] ?? []).filter((f) => f.name !== rf);
          parts.push(
            `CREATE TABLE ${q(t)} (\n${[...columns(schema), `  ${q(rf)} STRING`].join(',\n')}\n) ${KAFKA(t)};`,
          );
          inserts.push(
            `INSERT INTO ${q(t)}\nSELECT ${[list(schema), `${reasons.get(i.from) ?? 'CAST(NULL AS STRING)'} AS ${q(rf)}`].filter(Boolean).join(', ')} FROM ${q(i.from)};`,
          );
        }
        break;
      }
      case 'Window': {
        if (!from || !time) {
          todo(n, 'its input has no event-time column (a window needs one)');
          break;
        }
        const keys = (c['keyBy'] ?? []) as string[];
        const k = String(c['kind']);
        // FLINK: window TVFs, https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql/queries/window-tvf/
        // (SESSION as a TVF since 1.19, with PARTITION BY for the keys).
        const tvf =
          k === 'hop'
            ? `HOP(TABLE ${q(from)}, DESCRIPTOR(${q(time)}), ${ival(Number(c['slideMs']))}, ${ival(Number(c['sizeMs']))})`
            : k === 'cumulate'
              ? `CUMULATE(TABLE ${q(from)}, DESCRIPTOR(${q(time)}), ${ival(Number(c['slideMs']))}, ${ival(Number(c['sizeMs']))})`
              : k === 'session'
                ? `SESSION(TABLE ${q(from)}${keys.length ? ` PARTITION BY ${keys.map(q).join(', ')}` : ''}, DESCRIPTOR(${q(time)}), ${ival(Number(c['gapMs']))})`
                : `TUMBLE(TABLE ${q(from)}, DESCRIPTOR(${q(time)}), ${ival(Number(c['sizeMs']))})`;
        const aggs = ((c['aggregates'] ?? []) as { fn: string; field: string; as: string }[]).map((a) => {
          const typ = outSchema(n).find((f) => f.name === a.as)?.type ?? 'number';
          const arg = a.fn === 'count' && !a.field ? '*' : q(a.field);
          return `CAST(${AGG[a.fn]}(${arg}) AS ${SQL_TYPE[typ]}) AS ${q(a.as)}`;
        });
        const group = [...keys.map(q), '`window_start`', '`window_end`', '`window_time`'];
        view(
          me,
          `SELECT ${[...group, ...aggs].join(', ')}\nFROM TABLE(${tvf})\nGROUP BY ${group.join(', ')}`,
        );
        rt.set(me, 'window_time');
        const late = Number(c['allowedLatenessMs'] ?? 0) > 0;
        if (late || edgesFrom(n, 'late')) {
          // FLINK: window TVF aggregation drops late rows and has no allowed lateness or late side output.
          unsupported.push({ id: n.id, label: labelOf(n), type: n.type });
          parts.push(
            `-- TODO (EXPORT-UNSUPPORTED): ${labelOf(n)} — allowed lateness and the late output have no SQL; late rows are dropped.`,
          );
          tainted.add(outName(n.id, 'late'));
        }
        break;
      }
      case 'Join': {
        const [l, r] = (['left', 'right'] as const).map((port) => ins.find((i) => i.e.targetHandle === port));
        if (!l || !r) {
          todo(n, 'it needs both inputs');
          break;
        }
        const [lt, rtR] = [rt.get(l.from) ?? null, rt.get(r.from) ?? null];
        const lo = c['lowerMs'] as number | null;
        const hi = c['upperMs'] as number | null;
        const left = inSchema(n, 'left');
        const leftNames = new Set(left.map((f) => f.name));
        const right = inSchema(n, 'right').map(
          (f) => `R.${q(f.name)}${leftNames.has(f.name) ? ` AS ${q(`right_${f.name}`)}` : ''}`,
        );
        const on = [`L.${q(String(c['leftKey']))} = R.${q(String(c['rightKey']))}`];
        const bounded = lo !== null && hi !== null;
        if (bounded) {
          if (!lt || !rtR) {
            todo(n, 'an interval join needs an event-time column on both inputs');
            break;
          }
          // FLINK: interval join, l.t + lower <= r.t <= l.t + upper (the simulator's rule).
          on.push(`R.${q(rtR)} BETWEEN ${plus(`L.${q(lt)}`, lo)} AND ${plus(`L.${q(lt)}`, hi)}`);
        }
        view(
          me,
          `${bounded ? '' : '-- Regular join: no time bound, so its state grows without limit (JOIN-NO-BOUND).\n'}SELECT ${[list(left, 'L.'), ...right].filter(Boolean).join(', ')}\nFROM ${q(l.from)} AS L\n${c['kind'] === 'left' ? 'LEFT JOIN' : 'JOIN'} ${q(r.from)} AS R\nON ${on.join('\n  AND ')}`,
        );
        // FLINK: an interval join keeps both time attributes; a regular join keeps none.
        rt.set(me, bounded ? lt : null);
        break;
      }
      case 'Lookup': {
        const table = String(c['table']);
        const cols = ctx.refTables[table];
        if (!from || !cols) {
          todo(n, `reference table "${table}" is unknown`);
          break;
        }
        const tk = String(c['tableKey']);
        const asOf = Boolean(c['asOf']) && cols.some((f) => f.name === 'valid_from');
        if (asOf && !time) {
          todo(n, 'an as-of lookup needs an event-time column');
          break;
        }
        const tname = refDone.has(table) ? table : unique(table, true);
        if (!refDone.has(table)) {
          refDone.add(table);
          // FLINK: a temporal (versioned) table needs a primary key and an event-time attribute; a lookup
          // table is read per row by key. Connector options are placeholders.
          parts.push(
            asOf
              ? `CREATE TABLE ${q(tname)} (\n${columns(cols).join(',\n')},\n  PRIMARY KEY (${q(tk)}) NOT ENFORCED,\n  WATERMARK FOR ${q('valid_from')} AS ${q('valid_from')}\n) WITH (\n  'connector' = 'upsert-kafka',\n  'topic' = ${str(table)},\n  'properties.bootstrap.servers' = 'localhost:9092',\n  'key.format' = 'json',\n  'value.format' = 'json',\n  'value.json.timestamp-format.standard' = 'ISO-8601'\n);`
              : `CREATE TABLE ${q(tname)} (\n${columns(cols).join(',\n')},\n  PRIMARY KEY (${q(tk)}) NOT ENFORCED\n) WITH (\n  'connector' = 'jdbc',\n  'url' = 'jdbc:postgresql://localhost:5432/streamlab',\n  'table-name' = ${str(table)}\n);`,
          );
        }
        let probe = from;
        let at = `E.${q(time ?? '')}`;
        if (!asOf) {
          // FLINK: a lookup join reads the table at processing time.
          probe = unique(`${me}_probe`);
          view(probe, `SELECT *, PROCTIME() AS ${q('proc_time')} FROM ${q(from)}`);
          at = `E.${q('proc_time')}`;
        }
        const ev = inSchema(n);
        const evNames = new Set(ev.map((f) => f.name));
        const extra = cols
          .filter((f) => f.name !== tk)
          .map((f) => `T.${q(f.name)}${evNames.has(f.name) ? ` AS ${q(`right_${f.name}`)}` : ''}`);
        const join = (kind: string) =>
          `FROM ${q(probe)} AS E\n${kind} ${q(tname)} FOR SYSTEM_TIME AS OF ${at} AS T\nON E.${q(String(c['key']))} = T.${q(tk)}`;
        const miss = String(c['onMiss']);
        view(
          me,
          `SELECT ${[list(ev, 'E.'), ...extra].join(', ')}\n${join(miss === 'pass' ? 'LEFT JOIN' : 'JOIN')}`,
        );
        if (miss === 'reject' && edgesFrom(n, 'rejected')) {
          const r = outName(n.id, 'rejected');
          view(r, `SELECT ${list(ev, 'E.')}\n${join('LEFT JOIN')}\nWHERE T.${q(tk)} IS NULL`);
          reasons.set(r, str('no match'));
        }
        rt.set(me, time);
        break;
      }
      case 'Deduplicate': {
        const keys = (c['key'] ?? []) as string[];
        if (!from || !time) {
          todo(n, 'its input has no event-time column (deduplication orders by it)');
          break;
        }
        // FLINK: deduplication, https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql/queries/deduplication/
        // The TTL is the job's state TTL: SET 'table.exec.state.ttl' (not per query).
        const ttl = c['ttlMs'] as number | null;
        view(
          me,
          `${ttl ? `-- State TTL ${ival(ttl)}: SET 'table.exec.state.ttl' = '${ttl} ms';\n` : ''}SELECT ${list(inSchema(n))}\nFROM (\n  SELECT *, ROW_NUMBER() OVER (PARTITION BY ${keys.map(q).join(', ')} ORDER BY ${q(time)} ${c['keep'] === 'last' ? 'DESC' : 'ASC'}) AS ${q('rn')}\n  FROM ${q(from)}\n)\nWHERE ${q('rn')} = 1`,
        );
        rt.set(me, c['keep'] === 'last' ? null : time); // FLINK: keep-last emits updates (no time attribute)
        break;
      }
      case 'Top-N': {
        if (!from) break;
        const part = (c['partitionBy'] ?? []) as string[];
        const within = Boolean(c['withinWindow']);
        const sch = inSchema(n);
        if (within && !sch.some((f) => f.name === 'window_start')) {
          todo(n, '"within window" needs a Window before it (window_start / window_end)');
          break;
        }
        // FLINK: (window) Top-N, https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql/queries/window-topn/
        const by = [...(within ? ['`window_start`', '`window_end`'] : []), ...part.map(q)];
        view(
          me,
          `SELECT ${list(sch)}, CAST(${q('rn')} AS DOUBLE) AS ${q('rank')}\nFROM (\n  SELECT *, ROW_NUMBER() OVER (${by.length ? `PARTITION BY ${by.join(', ')} ` : ''}ORDER BY ${q(String(c['orderBy']))} ${c['desc'] ? 'DESC' : 'ASC'}) AS ${q('rn')}\n  FROM ${q(from)}\n)\nWHERE ${q('rn')} <= ${Number(c['n'])}`,
        );
        rt.set(me, null);
        break;
      }
      default:
        // Pattern (MATCH_RECOGNIZE gives one row per match; the node passes each matching event) and the SQL node
        // are v1.
        todo(n, 'no direct Flink SQL in this version');
    }
    // Views that did not say otherwise keep their input's time attribute.
    for (const port of outPorts(n)) {
      const o = outName(n.id, port);
      if (!rt.has(o)) rt.set(o, time);
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
