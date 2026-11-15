import { describe, expect, it } from 'vitest';
import {
  checkCel,
  closest,
  PAYMENTS,
  spec,
  validate,
  type NodeType,
  type PipelineEdge,
  type PipelineNode,
} from './index';

let seq = 0;
const node = (type: NodeType, config: object = {}, extra: Partial<PipelineNode> = {}): PipelineNode => ({
  id: extra.id ?? `c${++seq}`,
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
/** Issues for `n` when fed by a payments Source and drained into a Sink. */
function issuesOf(n: PipelineNode, refTables: Record<string, typeof PAYMENTS> = {}, src = node('Source')) {
  const k = node('Sink');
  const outs = spec(n.type).outputs(spec(n.type).defaults());
  const nodes = [src, n, k];
  const edges = [edge(src, n), ...(outs.some((o) => o.id === 'main') ? [edge(n, k)] : [])];
  return validate({ nodes, edges }, { refTables }).filter((i) => i.nodeId === n.id);
}
const codes = (n: PipelineNode, rt?: Record<string, typeof PAYMENTS>) => issuesOf(n, rt).map((i) => i.code);

describe('NODE-02 / NODE-06 · node checks', () => {
  it('NODE-REQUIRED for an empty required text, with the field and its path', () => {
    const k = node('Sink', { name: '' });
    const src = node('Source');
    const i = validate({ nodes: [src, k], edges: [edge(src, k)] }).find((x) => x.nodeId === k.id);
    expect(i).toMatchObject({ code: 'NODE-REQUIRED', params: { field: 'Name' }, field: 'name' });
  });

  it('NODE-REQUIRED for an empty expression', () => {
    expect(issuesOf(node('Filter', { expr: '  ' }))).toContainEqual(
      expect.objectContaining({ code: 'NODE-REQUIRED', params: { field: 'Expression' }, field: 'expr' }),
    );
  });

  it('CEL-PARSE with the column of the problem', () => {
    const i = issuesOf(node('Filter', { expr: 'amount > && 1' }))[0];
    expect(i).toMatchObject({ code: 'CEL-PARSE', params: { c: 10 }, field: 'expr', from: 9 });
  });

  it('CEL-UNKNOWN-FIELD lists the fields and offers the closest as a quick fix', () => {
    const i = issuesOf(node('Filter', { expr: 'amonut > 0' }))[0];
    expect(i).toMatchObject({
      code: 'CEL-UNKNOWN-FIELD',
      params: { f: 'amonut', list: PAYMENTS.map((f) => f.name).join(', ') },
      from: 0,
      to: 6,
      fix: 'amount',
    });
  });

  it('CEL-TYPE when a Filter does not return true/false', () => {
    expect(issuesOf(node('Filter', { expr: 'amount * 2.0' }))[0]).toMatchObject({
      code: 'CEL-TYPE',
      params: { expected: 'true/false', actual: 'a number' },
    });
  });

  it('CEL-PARSE explains decimal vs whole-number arithmetic', () => {
    expect(issuesOf(node('Filter', { expr: 'amount * 2 > 10.0' }))[0]).toMatchObject({
      code: 'CEL-PARSE',
      params: {
        reason: 'no such overload: double * int (with decimal fields, write numbers as decimals, e.g. 1.0)',
      },
    });
  });

  it('CEL-TYPE when a Map expression does not match its declared type', () => {
    const m = node('Map', { assignments: [{ field: 'big', expr: 'amount > 10', type: 'number' }] });
    expect(issuesOf(m)[0]).toMatchObject({ code: 'CEL-TYPE', field: 'assignments.0.expr' });
  });

  it('Validate and Route rules are checked one by one', () => {
    const v = node('Validate', {
      rules: [
        { name: 'a', expr: 'amount > 0', severity: 'error' },
        { name: 'b', expr: 'curency == "AED"', severity: 'error' },
      ],
    });
    expect(issuesOf(v).map((i) => [i.code, i.field])).toEqual([['CEL-UNKNOWN-FIELD', 'rules.1.expr']]);
  });

  it('a valid expression has no issues; with nothing connected only syntax is checked', () => {
    expect(codes(node('Filter', { expr: 'amount > 0 && currency == "AED"' }))).toEqual([]);
    expect(checkCel('anything > 1', [], 'bool')).toBeNull();
    expect(checkCel('anything >', [], 'bool')?.code).toBe('CEL-PARSE');
  });

  it('WIN-SIZE for size, slide and gap', () => {
    expect(issuesOf(node('Window', { sizeMs: 0 }))[0]).toMatchObject({ code: 'WIN-SIZE', field: 'sizeMs' });
    expect(issuesOf(node('Window', { kind: 'hop', sizeMs: 60000, slideMs: 120000 }))[0]).toMatchObject({
      code: 'WIN-SIZE',
      params: { reason: 'The slide must be more than 0 and at most the window size' },
    });
    expect(codes(node('Window', { kind: 'session', gapMs: 0 }))).toContain('WIN-SIZE');
  });

  it('WM-LATENESS-BIG when allowed lateness is more than 10× the window size', () => {
    expect(issuesOf(node('Window', { sizeMs: 60000, allowedLatenessMs: 660000 }))[0]).toMatchObject({
      code: 'WM-LATENESS-BIG',
      params: { x: '11 min' },
    });
    expect(codes(node('Window', { sizeMs: 60000, allowedLatenessMs: 600000 }))).toEqual([]);
  });

  it('WIN-NO-TIME when an upstream Source has no event-time field', () => {
    const src = node('Source', { eventTime: '' }, { label: 'Payments' });
    const w = node('Window');
    const k = node('Sink');
    const i = validate({ nodes: [src, w, k], edges: [edge(src, w), edge(w, k)] }).find(
      (x) => x.code === 'WIN-NO-TIME',
    );
    expect(i).toMatchObject({ params: { source: 'Payments' }, nodeId: w.id });
  });

  it('LOOKUP-NO-TABLE for a missing or empty table; LOOKUP-KEY-TYPE when key types differ', () => {
    expect(issuesOf(node('Lookup', { table: 'merchants' }))[0]).toMatchObject({
      code: 'LOOKUP-NO-TABLE',
      params: { t: 'merchants' },
    });
    const merchants = [
      { name: 'merchant_id', type: 'number' as const, required: true },
      { name: 'mcc', type: 'string' as const, required: true },
    ];
    expect(codes(node('Lookup', { table: 'merchants' }), { merchants })).toEqual(['LOOKUP-KEY-TYPE']);
  });

  it('JOIN-NO-BOUND (warning) when the interval is open', () => {
    const a = node('Source');
    const b = node('Source');
    const j = node('Join', { upperMs: null });
    const k = node('Sink');
    const all = validate({
      nodes: [a, b, j, k],
      edges: [edge(a, j, 'main', 'left'), edge(b, j, 'main', 'right'), edge(j, k)],
    });
    expect(all.filter((i) => i.nodeId === j.id).map((i) => i.code)).toEqual(['JOIN-NO-BOUND']);
  });

  it('DEDUP-NO-TTL (warning) without a TTL', () => {
    expect(codes(node('Deduplicate', { ttlMs: null }))).toEqual(['DEDUP-NO-TTL']);
  });

  it('ROUTE-OVERLAP (warning) without a default branch', () => {
    const r = node('Route', { defaultBranch: false });
    const src = node('Source');
    const k = node('Sink');
    const all = validate({ nodes: [src, r, k], edges: [edge(src, r), edge(r, k, 'route-r1')] });
    expect(all.filter((i) => i.nodeId === r.id).map((i) => i.code)).toEqual(['ROUTE-OVERLAP']);
  });

  it('PATTERN-INVALID names the step', () => {
    const p = node('Pattern', {
      steps: [
        { name: 'a', condition: 'amount > 0', min: 1, max: 1 },
        { name: 'b', condition: '', min: 1, max: 1 },
      ],
    });
    expect(issuesOf(p)[0]).toMatchObject({
      code: 'PATTERN-INVALID',
      params: { n: 2, reason: 'add a condition' },
    });
  });

  it('a field CEL reports as unknown is not also reported as SIM-SCHEMA-DRIFT', () => {
    expect(codes(node('Filter', { expr: 'zzz > 1' }))).toEqual(['CEL-UNKNOWN-FIELD']);
  });

  it('closest() suggests within 2 edits only', () => {
    expect(closest('amonut', ['amount', 'currency'])).toBe('amount');
    expect(closest('zzz', ['amount'])).toBeUndefined();
  });
});

describe('M2 audit · checks', () => {
  it('#1 validate never throws on names CEL can not register (empty, duplicate, built-in like "type")', () => {
    const schema = [
      { name: 'type', type: 'string' as const, required: true },
      { name: '', type: 'string' as const, required: true },
      { name: 'amount', type: 'number' as const, required: true },
      { name: 'amount', type: 'number' as const, required: true },
    ];
    const src = node('Source', { schema });
    const f = node('Filter', { expr: 'amount > 0' });
    const k = node('Sink');
    expect(() => validate({ nodes: [src, f, k], edges: [edge(src, f), edge(f, k)] })).not.toThrow();
  });

  it('#1 NODE-DUP-FIELD for a field set twice (Map), an aggregate name used twice, a duplicate schema field', () => {
    expect(
      codes(
        node('Map', {
          assignments: [
            { field: 'x', expr: 'amount', type: 'number' },
            { field: 'x', expr: 'amount', type: 'number' },
          ],
        }),
      ),
    ).toContain('NODE-DUP-FIELD');
    expect(
      codes(
        node('Window', {
          aggregates: [
            { fn: 'count', field: '', as: 'n' },
            { fn: 'count', field: '', as: 'n' },
          ],
        }),
      ),
    ).toContain('NODE-DUP-FIELD');
    const src = node('Source', {
      schema: [
        { name: 'a', type: 'string', required: true },
        { name: 'a', type: 'string', required: true },
      ],
    });
    const k = node('Sink');
    expect(validate({ nodes: [src, k], edges: [edge(src, k)] }).map((i) => i.code)).toContain(
      'NODE-DUP-FIELD',
    );
  });

  it('#4 optional fields can be null-checked', () => {
    expect(checkCel('mcc != null', [{ name: 'mcc', type: 'string', required: false }], 'bool')).toBeNull();
  });

  it('#6 a disabled upstream Source does not raise WIN-NO-TIME', () => {
    const off = node('Source', { eventTime: '' }, { disabled: true });
    const gen = node('Generator');
    const u = node('Union');
    const w = node('Window');
    const k = node('Sink');
    const all = validate({
      nodes: [off, gen, u, w, k],
      edges: [edge(off, u), edge(gen, u), edge(u, w), edge(w, k)],
    });
    expect(all.filter((i) => i.nodeId === w.id).map((i) => i.code)).not.toContain('WIN-NO-TIME');
  });

  it('#7 WIN-NO-TIME when the event-time field is missing from the schema or is not a timestamp', () => {
    for (const eventTime of ['ts', 'amount']) {
      const src = node('Source', { eventTime });
      const w = node('Window');
      const k = node('Sink');
      const all = validate({ nodes: [src, w, k], edges: [edge(src, w), edge(w, k)] });
      expect(
        all.map((i) => i.code),
        eventTime,
      ).toContain('WIN-NO-TIME');
    }
  });

  it('#8 the decimal hint does not name a number the user did not write, and covers lists', () => {
    const a = checkCel('amount == 1', PAYMENTS, 'bool');
    expect(String(a?.params.reason)).not.toContain('2.0 instead of 2');
    expect(String(a?.params.reason)).toContain('decimal');
    expect(String(checkCel('amount in [1, 2]', PAYMENTS, 'bool')?.params.reason)).toContain('decimal');
  });

  it('#9 CEL-TYPE uses plain words for durations', () => {
    const p = checkCel('event_time - timestamp("2026-01-01T00:00:00Z")', PAYMENTS, 'double');
    expect(p?.params.actual).toBe('a duration');
  });

  it('#11 NODE-RANGE for numbers outside their range (Top-N N ≥ 1, TTL > 0)', () => {
    expect(issuesOf(node('Top-N', { n: 0 }))[0]).toMatchObject({
      code: 'NODE-RANGE',
      params: { field: 'N', rule: 'at least 1' },
    });
    expect(codes(node('Deduplicate', { ttlMs: 0 }))).toContain('NODE-RANGE');
  });

  it('#12 NODE-REQUIRED names nested settings by their row', () => {
    const src = node('Source', { schema: [{ name: '', type: 'string', required: true }] });
    const k = node('Sink');
    const i = validate({ nodes: [src, k], edges: [edge(src, k)] }).find((x) => x.code === 'NODE-REQUIRED');
    expect(i?.params.field).toBe('Field 1 name');
  });
});
