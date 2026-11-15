import { describe, expect, it } from 'vitest';
import {
  connectionIssue,
  inferSchema,
  migrate,
  NODES,
  newPipeline,
  parsePipeline,
  propagate,
  runBlocker,
  spec,
  toJsonSchema,
  validate,
  fieldsIn,
  type Graph,
  type NodeType,
  type PipelineEdge,
  type PipelineNode,
} from './index';

let seq = 0;
const node = (type: NodeType, config: object = {}, extra: Partial<PipelineNode> = {}): PipelineNode => ({
  id: extra.id ?? `n${++seq}`,
  type,
  position: { x: 0, y: 0 },
  config: { ...(spec(type).defaults() as object), ...config },
  ...extra,
});
const edge = (s: PipelineNode, t: PipelineNode, sh = 'main', th = 'main'): PipelineEdge => ({
  id: `e-${s.id}-${sh}-${t.id}-${th}`,
  source: s.id,
  sourceHandle: sh,
  target: t.id,
  targetHandle: th,
});
const codes = (g: Graph) => validate(g).map((i) => i.code);

describe('NODE-06 · registry', () => {
  it('has all 16 node types, each keyed by its own type, with valid defaults', () => {
    expect(Object.keys(NODES)).toHaveLength(16);
    for (const [k, s] of Object.entries(NODES)) {
      expect(s.type).toBe(k);
      expect(spec(s.type).config.safeParse(spec(s.type).defaults()).success, k).toBe(true);
    }
  });

  it('Pattern and SQL are v1; the 14 others are Phase 1 (B-02 core nodes + Generator + Union)', () => {
    expect(
      Object.values(NODES)
        .filter((n) => 'v1' in n && n.v1)
        .map((n) => n.type),
    ).toEqual(['Pattern', 'SQL']);
  });

  it('Join has left/right inputs; sources have no inputs; sinks no outputs (port arity)', () => {
    expect(
      spec('Join')
        .inputs(spec('Join').defaults())
        .map((p) => p.id),
    ).toEqual(['left', 'right']);
    expect(spec('Source').inputs(spec('Source').defaults())).toEqual([]);
    expect(spec('Sink').outputs(spec('Sink').defaults())).toEqual([]);
  });

  it('Route has one output per rule plus default', () => {
    const c = {
      routes: [
        { id: 'a', name: 'a', expr: 'true' },
        { id: 'b', name: 'b', expr: 'true' },
      ],
      defaultBranch: true,
    };
    expect(
      spec('Route')
        .outputs(c)
        .map((p) => p.id),
    ).toEqual(['route-a', 'route-b', 'default']);
  });
});

describe('SIM-25 · schemas', () => {
  it('propagates from the source along edges and changes at Window', () => {
    const src = node('Source');
    const f = node('Filter');
    const w = node('Window');
    const s = propagate({ nodes: [src, f, w], edges: [edge(src, f), edge(f, w)] });
    expect(s.edge.get(edge(src, f).id)!.map((x) => x.name)).toContain('amount');
    expect(s.out.get(w.id)!.main!.map((x) => x.name)).toEqual([
      'card_id',
      'window_start',
      'window_end',
      'payments',
    ]);
    expect(s.out.get(w.id)!.late).toEqual(s.out.get(f.id)!.main);
  });

  it('a disabled node passes its input through', () => {
    const src = node('Source');
    const m = node('Map', { drop: ['amount'] }, { disabled: true });
    const s = propagate({ nodes: [src, m], edges: [edge(src, m)] });
    expect(s.out.get(m.id)!.main!.map((x) => x.name)).toContain('amount');
  });

  it('infers types and required-ness from sample rows', () => {
    const schema = inferSchema([
      { payment_id: 'p1', amount: 12.5, ok: true, event_time: '2026-11-15T12:00:00Z', note: 'x' },
      { payment_id: 'p2', amount: 7, ok: false, event_time: '2026-11-15T12:00:01Z' },
    ]);
    expect(schema).toEqual([
      { name: 'payment_id', type: 'string', required: true },
      { name: 'amount', type: 'number', required: true },
      { name: 'ok', type: 'boolean', required: true },
      { name: 'event_time', type: 'timestamp', required: true },
      { name: 'note', type: 'string', required: false },
    ]);
  });

  it('mixed types widen to string', () => {
    expect(inferSchema([{ v: 1 }, { v: 'x' }])[0]!.type).toBe('string');
  });

  it('renders as JSON Schema', () => {
    expect(toJsonSchema([{ name: 'event_time', type: 'timestamp', required: true }])).toEqual({
      type: 'object',
      properties: { event_time: { type: 'string', format: 'date-time' } },
      required: ['event_time'],
    });
  });

  it('fieldsIn finds fields read by an expression, ignoring strings, calls and members', () => {
    expect(fieldsIn('amount > 0 && currency == "AED" && size(card_id) > 3 && meta.x')).toEqual([
      'amount',
      'currency',
      'card_id',
      'meta',
    ]);
  });
});

describe('SIM-06/07 · connecting', () => {
  const src = node('Source', {}, { id: 'src' });
  const a = node('Filter', {}, { id: 'a' });
  const b = node('Filter', {}, { id: 'b' });
  const g: Graph = { nodes: [src, a, b], edges: [edge(src, a), edge(a, b)] };
  const conn = (s: string, t: string, sh = 'main', th = 'main') => ({
    source: s,
    target: t,
    sourceHandle: sh,
    targetHandle: th,
  });

  it('SIM-07 rejects a self-loop with SIM-CYCLE', () => {
    expect(connectionIssue(g, conn('a', 'a'))?.code).toBe('SIM-CYCLE');
  });

  it('SIM-07 rejects a cycle with SIM-CYCLE', () => {
    expect(connectionIssue(g, conn('b', 'a', 'rejected'))?.code).toBe('SIM-CYCLE');
  });

  it('SIM-07 rejects a duplicate edge with SIM-DUP-EDGE', () => {
    const g2: Graph = { nodes: [src, a], edges: [edge(src, a)] };
    expect(connectionIssue(g2, conn('src', 'a'))?.code).toBe('SIM-DUP-EDGE');
  });

  it('SIM-PORT-TAKEN when a single-input port already has an edge', () => {
    const other = node('Source', {}, { id: 'other' });
    const i = connectionIssue({ nodes: [...g.nodes, other], edges: g.edges }, conn('other', 'a'));
    expect(i).toMatchObject({ code: 'SIM-PORT-TAKEN', params: { port: 'in', node: 'Filter' } });
  });

  it('Union accepts several inputs on one port', () => {
    const s2 = node('Source', {}, { id: 's2' });
    const u = node('Union', {}, { id: 'u' });
    const g2: Graph = { nodes: [src, s2, u], edges: [edge(src, u)] };
    expect(connectionIssue(g2, conn('s2', 'u'))).toBeNull();
  });

  it('SIM-06 SIM-PORT-TYPE when the target needs fields the source does not have', () => {
    const narrow = node(
      'Source',
      { schema: [{ name: 'amount', type: 'number', required: true }] },
      { id: 'narrow' },
    );
    const w = node('Window', {}, { id: 'w' });
    expect(connectionIssue({ nodes: [narrow, w], edges: [] }, conn('narrow', 'w'))).toMatchObject({
      code: 'SIM-PORT-TYPE',
      params: { a: 'Source', has: 'amount', b: 'Window', needs: 'card_id' },
    });
  });

  it('a valid connection returns null', () => {
    const w = node('Window', {}, { id: 'w2' });
    expect(connectionIssue({ nodes: [src, w], edges: [] }, conn('src', 'w2'))).toBeNull();
  });

  it('an unknown port is a programming error, not a user message', () => {
    expect(() => connectionIssue(g, conn('src', 'a', 'main', 'nope'))).toThrow(/unknown port/);
  });
});

describe('SIM-14 · graph validation', () => {
  it('SIM-NO-SOURCE on an empty or source-less graph', () => {
    expect(codes({ nodes: [], edges: [] })).toEqual(['SIM-NO-SOURCE']);
    expect(codes({ nodes: [node('Sink')], edges: [] })).toContain('SIM-NO-SOURCE');
  });

  it('SIM-NO-SOURCE when the only source is disabled', () => {
    expect(codes({ nodes: [node('Source', {}, { disabled: true })], edges: [] })).toContain('SIM-NO-SOURCE');
  });

  it('SIM-DISCONNECTED for a node with an unconnected input (Join needs both)', () => {
    const src = node('Source');
    const j = node('Join', {}, { label: 'Refund match' });
    const sink = node('Sink');
    const issues = validate({ nodes: [src, j, sink], edges: [edge(src, j, 'main', 'left'), edge(j, sink)] });
    expect(issues).toContainEqual({
      code: 'SIM-DISCONNECTED',
      params: { node: 'Refund match (right)' },
      nodeId: j.id,
    });
  });

  it('SIM-NO-SINK when a main output goes nowhere; side outputs may stay open', () => {
    const src = node('Source');
    const f = node('Filter', {}, { label: 'Big payments' });
    const sink = node('Sink');
    expect(codes({ nodes: [src, f], edges: [edge(src, f)] })).toContain('SIM-NO-SINK');
    expect(codes({ nodes: [src, f, sink], edges: [edge(src, f), edge(f, sink)] })).toEqual([]);
  });

  it('SIM-SCHEMA-DRIFT when an upstream edit removes a field a node reads', () => {
    const src = node('Source');
    const m = node('Map', { drop: ['card_id'] }, { label: 'Strip PII' });
    const w = node('Window', {}, { label: 'Bursts per card' });
    const sink = node('Sink');
    const issues = validate({ nodes: [src, m, w, sink], edges: [edge(src, m), edge(m, w), edge(w, sink)] });
    expect(issues).toContainEqual({
      code: 'SIM-SCHEMA-DRIFT',
      params: { node: 'Bursts per card', field: 'card_id', upstream: 'Strip PII' },
      nodeId: w.id,
    });
  });

  it('SIM-UNION-SCHEMA when union inputs differ', () => {
    const a = node('Source', {}, { label: 'Payments' });
    const b = node(
      'Source',
      { schema: [{ name: 'refund_id', type: 'string', required: true }] },
      { label: 'Refunds' },
    );
    const u = node('Union');
    const sink = node('Sink');
    const issues = validate({ nodes: [a, b, u, sink], edges: [edge(a, u), edge(b, u), edge(u, sink)] });
    expect(issues.find((i) => i.code === 'SIM-UNION-SCHEMA')).toMatchObject({
      params: { a: 'Payments', b: 'Refunds', y: 'refund_id' },
    });
  });

  it('SIM-15 SIM-RUN-BLOCKED counts errors only, not warnings', () => {
    const src = node('Source');
    const f = node('Filter');
    const issues = validate({ nodes: [src, f], edges: [edge(src, f)] }); // SIM-NO-SINK is a warning
    expect(runBlocker(issues)).toBeNull();
    expect(runBlocker(validate({ nodes: [], edges: [] }))).toEqual({
      code: 'SIM-RUN-BLOCKED',
      params: { n: 1 },
    });
  });
});

describe('M1 audit fixes · graph', () => {
  it('#9 Route handles follow the rule id, so removing a rule does not re-point edges', () => {
    const c = {
      routes: [
        { id: 'a', name: 'a', expr: 'true' },
        { id: 'b', name: 'b', expr: 'true' },
      ],
      defaultBranch: false,
    };
    expect(
      spec('Route')
        .outputs(c)
        .map((p) => p.id),
    ).toEqual(['route-a', 'route-b']);
    expect(
      spec('Route')
        .outputs({ ...c, routes: [c.routes[1]!] })
        .map((p) => p.id),
    ).toEqual(['route-b']);
  });

  it('#10 one SIM-SCHEMA-DRIFT per (node, field), however many settings read it', () => {
    const src = node('Source');
    const m = node('Map', { drop: ['amount'] });
    // keyBy and an aggregate both read "amount": one drift row, not two.
    const w = node('Window', { keyBy: ['amount'], aggregates: [{ fn: 'max', field: 'amount', as: 'top' }] });
    const k = node('Sink');
    const issues = validate({ nodes: [src, m, w, k], edges: [edge(src, m), edge(m, w), edge(w, k)] });
    expect(issues.filter((i) => i.code === 'SIM-SCHEMA-DRIFT')).toHaveLength(1);
  });

  it('#11 a disabled Join passes its LEFT input through (schema checks stay on downstream)', () => {
    const a = node('Source');
    // Right side has a different schema, so passing the right input through would be caught.
    const b = node('Source', { schema: [{ name: 'refund_id', type: 'string', required: true }] });
    const sp = propagate({
      nodes: [a, b, node('Join', {}, { id: 'jj', disabled: true })],
      edges: [
        edge(a, { id: 'jj' } as never, 'main', 'left'),
        edge(b, { id: 'jj' } as never, 'main', 'right'),
      ],
    });
    expect(sp.out.get('jj')!.main!.map((f) => f.name)).toContain('payment_id');
    const j = node('Join', {}, { disabled: true });
    const w = node('Window', { keyBy: ['nonexistent'] });
    const k = node('Sink');
    const issues = validate({
      nodes: [a, b, j, w, k],
      edges: [edge(a, j, 'main', 'left'), edge(b, j, 'main', 'right'), edge(j, w), edge(w, k)],
    });
    expect(issues.map((i) => i.code)).toContain('SIM-SCHEMA-DRIFT');
  });

  it('#15 SIM-PORT-TYPE when a numeric aggregate reads a string field', () => {
    const src = node('Source', {}, { id: 'p' });
    const w = node('Window', { aggregates: [{ fn: 'sum', field: 'currency', as: 's' }] }, { id: 'w' });
    expect(
      connectionIssue(
        { nodes: [src, w], edges: [] },
        { source: 'p', sourceHandle: 'main', target: 'w', targetHandle: 'main' },
      ),
    ).toMatchObject({ code: 'SIM-PORT-TYPE', params: { needs: 'currency (number)' } });
  });

  it('#16 a disabled target takes any schema (as validate does)', () => {
    const src = node('Source', {}, { id: 'p' });
    const f = node('Filter', { expr: 'zzz > 1' }, { id: 'f', disabled: true });
    expect(
      connectionIssue(
        { nodes: [src, f], edges: [] },
        { source: 'p', sourceHandle: 'main', target: 'f', targetHandle: 'main' },
      ),
    ).toBeNull();
  });

  it('#17 a half-connected Join names the missing input', () => {
    const a = node('Source');
    const j = node('Join', {}, { label: 'Refund match' });
    const k = node('Sink');
    const issues = validate({ nodes: [a, j, k], edges: [edge(a, j, 'main', 'left'), edge(j, k)] });
    expect(issues).toContainEqual({
      code: 'SIM-DISCONNECTED',
      params: { node: 'Refund match (right)' },
      nodeId: j.id,
    });
  });
});

describe('M1 audit 2 · graph', () => {
  it('#5 validation catches a type change upstream (SIM-SCHEMA-DRIFT names the needed type)', () => {
    const src = node('Source');
    const m = node(
      'Map',
      { assignments: [{ field: 'amount', expr: 'string(amount)', type: 'string' }] },
      { label: 'To text' },
    );
    const w = node(
      'Window',
      { aggregates: [{ fn: 'sum', field: 'amount', as: 'total' }] },
      { label: 'Totals' },
    );
    const k = node('Sink');
    const issues = validate({ nodes: [src, m, w, k], edges: [edge(src, m), edge(m, w), edge(w, k)] });
    expect(issues).toContainEqual({
      code: 'SIM-SCHEMA-DRIFT',
      params: { node: 'Totals', field: 'amount (number)', upstream: 'To text' },
      nodeId: w.id,
    });
  });

  it('#9 Window min/max accept timestamps and keep the field type', () => {
    const src = node('Source', {}, { id: 'p' });
    const w = node(
      'Window',
      { aggregates: [{ fn: 'max', field: 'event_time', as: 'last_seen' }] },
      { id: 'w' },
    );
    expect(
      connectionIssue(
        { nodes: [src, w], edges: [] },
        { source: 'p', sourceHandle: 'main', target: 'w', targetHandle: 'main' },
      ),
    ).toBeNull();
    const out = propagate({ nodes: [src, w], edges: [edge(src, w)] }).out.get('w')!.main!;
    expect(out.find((f) => f.name === 'last_seen')!.type).toBe('timestamp');
  });
});

describe('SIM-02 · import (IMPORT-INVALID)', () => {
  const good = () => {
    const p = newPipeline('p_1', 'Card bursts', new Date('2026-11-15T00:00:00Z'));
    const src = node('Source', {}, { id: 's' });
    const sink = node('Sink', {}, { id: 'k' });
    return { ...p, nodes: [src, sink], edges: [edge(src, sink)] };
  };
  const reason = (input: unknown) => {
    const r = parsePipeline(input, 'card-bursts.json');
    return r.ok ? null : r.issue.params.reason;
  };

  it('accepts a valid v1 pipeline (object or JSON text)', () => {
    expect(parsePipeline(good(), 'x.json').ok).toBe(true);
    expect(parsePipeline(JSON.stringify(good()), 'x.json').ok).toBe(true);
  });

  it('IMPORT-INVALID: not JSON / not a pipeline / newer version', () => {
    expect(reason('{nope')).toBe('it is not valid JSON');
    expect(reason({ hello: 1 })).toBe('it is not a Stream Lab pipeline');
    expect(reason({ ...good(), schemaVersion: 2 })).toBe('it was made with a newer Stream Lab');
  });

  it('IMPORT-INVALID: unknown node type, missing node, duplicate id, loop, bad setting', () => {
    expect(reason({ ...good(), nodes: [{ ...good().nodes[0]!, type: 'Kafka' }] })).toMatch(/unknown type/);
    expect(reason({ ...good(), edges: [{ ...good().edges[0]!, target: 'ghost' }] })).toMatch(/missing node/);
    expect(reason({ ...good(), nodes: [good().nodes[0]!, good().nodes[0]!] })).toMatch(/used twice/);
    const f1 = node('Filter', {}, { id: 'f1' });
    const f2 = node('Filter', {}, { id: 'f2' });
    expect(reason({ ...good(), nodes: [f1, f2], edges: [edge(f1, f2), edge(f2, f1)] })).toBe(
      'it contains a loop',
    );
    expect(reason({ ...good(), nodes: [node('Filter', { expr: 42 }, { id: 'f' })], edges: [] })).toMatch(
      /node "f" has a bad setting \(expr\)/,
    );
  });

  it('#2 IMPORT-INVALID: unknown handle, edge id reused, two edges into one input', () => {
    const g = good();
    const e = g.edges[0]!;
    expect(reason({ ...g, edges: [{ ...e, sourceHandle: 'bogus' }] })).toMatch(
      /edge "e-s-main-k-main" uses an output "bogus"/,
    );
    expect(reason({ ...g, edges: [{ ...e, targetHandle: 'nope' }] })).toMatch(/uses an input "nope"/);
    const s2 = node('Source', {}, { id: 's2' });
    expect(reason({ ...g, nodes: [...g.nodes, s2], edges: [e, { ...e, source: 's2' }] })).toMatch(
      /used twice/,
    );
    expect(reason({ ...g, nodes: [...g.nodes, s2], edges: [e, { ...e, id: 'e2', source: 's2' }] })).toMatch(
      /takes one edge on its input/,
    );
  });

  it('#14 too-small numbers are refused; only empty text/lists pass through to the drawer', () => {
    expect(reason({ ...good(), nodes: [node('Top-N', { n: 0 }, { id: 't' })], edges: [] })).toMatch(
      /bad setting \(n\)/,
    );
  });

  it('#18 reasons are plain words, not schema-validator text', () => {
    const r = reason({ ...good(), nodes: [{ ...good().nodes[0]!, type: 'Kafka' }] });
    expect(r).toBe('node 1 has an unknown type "Kafka"');
  });

  it('a half-filled setting (empty required name) still imports; the drawer flags it', () => {
    expect(reason({ ...good(), nodes: [node('Sink', { name: '' }, { id: 'k' })], edges: [] })).toBeNull();
  });

  it('migrations run vN → vN+1 in order and stamp the version', () => {
    const calls: number[] = [];
    const out = migrate(
      { schemaVersion: 1, a: 1 },
      { 1: (p) => (calls.push(1), { ...p, b: 2 }), 2: (p) => (calls.push(2), { ...p, c: 3 }) },
      3,
    );
    expect(calls).toEqual([1, 2]);
    expect(out).toEqual({ schemaVersion: 3, a: 1, b: 2, c: 3 });
    expect(() => migrate({ schemaVersion: 1 }, {}, 2)).toThrow(/No migration/);
  });
});
