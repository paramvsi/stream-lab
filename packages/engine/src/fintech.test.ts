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
        node('gen', 'Generator', { count: 200, badRowsPct: 0 }),
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
