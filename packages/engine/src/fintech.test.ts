import { spec, validate, type Graph, type NodeType, type PipelineEdge, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import { BUILTIN_TABLES, refSchemas } from './fintech';
import { BASE_TIME } from './random';

const node = (id: string, type: NodeType, config: object = {}): PipelineNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { ...(spec(type).defaults() as object), ...config },
});
const edge = (s: string, t: string, sh = 'main', th = 'main'): PipelineEdge => ({
  id: `${s}-${sh}-${t}-${th}`,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
});

describe('DATA-05 · fintech reference tables', () => {
  it('merchants, fx_rates and blocklist exist, keyed to what the generator emits', () => {
    expect(Object.keys(BUILTIN_TABLES)).toEqual(['merchants', 'fx_rates', 'blocklist']);
    const ids = new Set(BUILTIN_TABLES['merchants']!.rows.map((r) => r['merchant_id']));
    expect(ids.size).toBe(12);
    expect(BUILTIN_TABLES['fx_rates']!.rows.filter((r) => r['currency'] === 'AED')).toHaveLength(480);
  });

  it('DATA-03 a Lookup on merchants enriches events, and validation knows the table (no LOOKUP-NO-TABLE)', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { count: 1000, badRowsPct: 0 }), // 20 s: past the 5 s and 12 s versions
        node('l', 'Lookup', {
          table: 'merchants',
          key: 'merchant_id',
          tableKey: 'merchant_id',
          asOf: true,
          onMiss: 'reject',
        }),
        node('f', 'Filter', { expr: 'risk_tier == "high"' }),
        node('out', 'Sink'),
        node('dlq', 'Dead-letter'),
      ],
      edges: [
        edge('gen', 'l'),
        edge('l', 'f'),
        edge('f', 'out'),
        edge('l', 'dlq', 'rejected'),
        edge('f', 'dlq', 'rejected'),
      ],
    };
    expect(validate(g, { refTables: refSchemas(BUILTIN_TABLES) }).map((i) => i.code)).not.toContain(
      'LOOKUP-NO-TABLE',
    );
    const r = createRun(g);
    r.advance(Infinity);
    const s = r.stats();
    expect(s.nodes['l']!.out['rejected'] ?? 0).toBe(0); // every generated merchant is in the table
    expect(s.nodes['f']!.failed).toBe(0); // the table's fields reach the Filter's expression
    // Non-empty first: `every` on an empty list passes (audit: the check below could not fail).
    expect(s.outputs['out']!.length).toBeGreaterThan(0);
    expect(s.outputs['out']!.every((e) => e['risk_tier'] === 'high' && typeof e['name'] === 'string')).toBe(
      true,
    );
  });

  it('DATA-03 versioned: an as-of lookup sees the version valid at the event time (W13b)', () => {
    const SCHEMA = [
      { name: 'currency', type: 'string', required: true },
      { name: 'event_time', type: 'timestamp', required: true },
    ];
    const at = (min: number, sec: number) => new Date(BASE_TIME + min * 60000 + sec * 1000).toISOString();
    const g: Graph = {
      nodes: [
        node('s', 'Source', { schema: SCHEMA, outOfOrdernessMs: 0 }),
        node('l', 'Lookup', {
          table: 'fx_rates',
          key: 'currency',
          tableKey: 'currency',
          asOf: true,
          onMiss: 'reject',
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('s', 'l'), edge('l', 'out')],
    };
    const r = createRun(g, {
      sourceData: {
        s: [
          { currency: 'AED', event_time: at(2, 41) },
          { currency: 'AED', event_time: at(3, 5) },
        ],
      },
    });
    r.advance(Infinity);
    const rate = (min: number) =>
      BUILTIN_TABLES['fx_rates']!.rows.find(
        (x) => x['currency'] === 'AED' && x['valid_from'] === new Date(BASE_TIME + min * 60000).toISOString(),
      )!['rate_to_usd'];
    expect(r.stats().outputs['out']!.map((e) => e['rate_to_usd'])).toEqual([rate(2), rate(3)]);
  });

  it('a blocklist lookup that rejects misses leaves only blocklisted merchants', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { count: 300, badRowsPct: 0 }),
        node('l', 'Lookup', {
          table: 'blocklist',
          key: 'merchant_id',
          tableKey: 'merchant_id',
          asOf: false,
          onMiss: 'drop',
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('gen', 'l'), edge('l', 'out')],
    };
    const r = createRun(g);
    r.advance(Infinity);
    const hits = r.stats().outputs['out']!;
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((e) => e['merchant_id']))).toEqual(new Set(['m_103', 'm_107', 'm_110']));
  });
});

describe('fintech audit', () => {
  const lookup = (
    config: object,
    schema: { name: string; type: string; required: boolean }[],
    rows: object[],
  ) => {
    const g: Graph = {
      nodes: [
        node('s', 'Source', { schema, outOfOrdernessMs: 0 }),
        node('l', 'Lookup', { asOf: true, onMiss: 'reject', ...config }),
        node('out', 'Sink'),
      ],
      edges: [edge('s', 'l'), edge('l', 'out')],
    };
    const r = createRun(g, { sourceData: { s: rows as never } });
    r.advance(Infinity);
    return { g, out: r.stats().outputs['out']! };
  };
  const SCHEMA = [
    { name: 'merchant_id', type: 'string', required: true },
    { name: 'country', type: 'string', required: true },
    { name: 'event_time', type: 'timestamp', required: true },
  ];
  const ev = { merchant_id: 'm_103', country: 'AE', event_time: new Date(BASE_TIME).toISOString() };

  it('#1 a table column that clashes with an event field arrives as right_<name>, as the schema says', () => {
    const { out } = lookup({ table: 'merchants', key: 'merchant_id', tableKey: 'merchant_id' }, SCHEMA, [ev]);
    expect(out[0]!['country']).toBe('AE');
    expect(out[0]!['right_country']).toBe('OM');
  });

  it('#6 a table key that is not a column of the table is an issue (LOOKUP-TABLE-KEY)', () => {
    const { g } = lookup({ table: 'fx_rates', key: 'merchant_id', tableKey: 'merchant_id' }, SCHEMA, []);
    expect(validate(g, { refTables: refSchemas(BUILTIN_TABLES) }).map((i) => i.code)).toContain(
      'LOOKUP-TABLE-KEY',
    );
  });

  it('#5 an as-of lookup on fx_rates handles 20,000 events quickly (indexed versions)', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { count: 20000 }),
        node('l', 'Lookup', {
          table: 'fx_rates',
          key: 'currency',
          tableKey: 'currency',
          asOf: true,
          onMiss: 'pass',
        }),
        node('out', 'Sink'),
      ],
      edges: [edge('gen', 'l'), edge('l', 'out')],
    };
    const t = performance.now();
    const r = createRun(g);
    r.advance(Infinity);
    expect(performance.now() - t).toBeLessThan(600);
  });

  it('#7 with default settings a run sees merchant risk tiers change (versions inside the first 20 s)', () => {
    const g: Graph = {
      nodes: [
        node('gen', 'Generator', { badRowsPct: 0 }),
        node('l', 'Lookup', {
          table: 'merchants',
          key: 'merchant_id',
          tableKey: 'merchant_id',
          asOf: true,
          onMiss: 'reject',
        }),
        node('f', 'Filter', { expr: 'risk_tier == "high"' }),
        node('out', 'Sink'),
        node('dlq', 'Dead-letter'),
      ],
      edges: [
        edge('gen', 'l'),
        edge('l', 'f'),
        edge('f', 'out'),
        edge('l', 'dlq', 'rejected'),
        edge('f', 'dlq', 'rejected'),
      ],
    };
    const r = createRun(g);
    r.advance(Infinity);
    expect(r.stats().outputs['out']!.length).toBeGreaterThan(0);
  });

  it('#11 a lookup that is not as-of uses the version current at the run clock, never a future one', () => {
    const { out } = lookup(
      { table: 'merchants', key: 'merchant_id', tableKey: 'merchant_id', asOf: false },
      SCHEMA.filter((f) => f.name !== 'country'),
      [{ merchant_id: 'm_101', event_time: new Date(BASE_TIME).toISOString() }],
    );
    expect(out[0]!['risk_tier']).toBe('low'); // the first version; later ones are not valid yet
  });
});
