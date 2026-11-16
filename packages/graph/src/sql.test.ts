import { describe, expect, it } from 'vitest';
import { celToSql, toFlinkSql } from './sql';
import { PAYMENTS } from './nodes';
import type { Graph } from './graph';
import type { NodeType, PipelineNode } from './types';

const node = (
  id: string,
  type: NodeType,
  config: Record<string, unknown> = {},
  label?: string,
): PipelineNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config,
  ...(label ? { label } : {}),
});
const edge = (source: string, target: string, sourceHandle = 'main', targetHandle = 'main') => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const SRC = {
  name: 'payments',
  schema: PAYMENTS,
  eventTime: 'event_time',
  outOfOrdernessMs: 5000,
  idleTimeoutMs: 0,
};

describe('EXP-01 CEL to Flink SQL', () => {
  it('translates the plain subset', () => {
    expect(celToSql('amount > 3.5 && status == "approved"')).toBe(
      "(`amount` > 3.5 AND `status` = 'approved')",
    );
    expect(celToSql('!(a || b) ? 1 : 2')).toBe('CASE WHEN NOT ((`a` OR `b`)) THEN 1 ELSE 2 END');
    expect(celToSql('currency in ["AED", "USD"]')).toBe("`currency` IN ('AED', 'USD')");
    expect(celToSql('x == null')).toBe('`x` IS NULL');
    expect(celToSql('size(card_id) > 0')).toBe('CHAR_LENGTH(`card_id`) > 0');
    expect(celToSql('merchant_id.startsWith("m_1")')).toBe("`merchant_id` LIKE 'm\\_1%' ESCAPE '\\'");
    expect(celToSql('name == "o\'hara"')).toBe("`name` = 'o''hara'");
    expect(celToSql('amount % 2 == 0')).toBe('MOD(`amount`, 2) = 0');
  });
  it('anything else is not guessed (null)', () => {
    expect(celToSql('tags.exists(t, t == "x")')).toBeNull();
    expect(celToSql('timestamp("2026-01-01T00:00:00Z") < event_time')).toBeNull();
    expect(celToSql('amount >')).toBeNull();
  });
});

describe('EXP-01 Flink SQL export (sources, filter, map, route, union, validate, sinks)', () => {
  const g: Graph = {
    nodes: [
      node('src', 'Source', SRC),
      node('flt', 'Filter', { expr: 'amount > 100' }, 'Big ones'),
      node('map', 'Map', {
        assignments: [{ field: 'amount_usd', expr: 'amount * 0.27', type: 'number' }],
        drop: ['status'],
      }),
      node('out', 'Sink', { name: 'big_payments', format: 'json', key: '' }),
    ],
    edges: [edge('src', 'flt'), edge('flt', 'map'), edge('map', 'out')],
  };
  it('a source table with its watermark, views per node, and the INSERT', () => {
    const { sql, unsupported } = toFlinkSql(g);
    expect(unsupported).toEqual([]);
    expect(sql).toContain('CREATE TABLE `payments` (');
    expect(sql).toContain('`event_time` TIMESTAMP(3)');
    expect(sql).toContain("WATERMARK FOR `event_time` AS `event_time` - INTERVAL '5' SECOND");
    expect(sql).toContain(
      'CREATE TEMPORARY VIEW `big_ones` AS\nSELECT * FROM `payments`\nWHERE `amount` > 100;',
    );
    expect(sql).toContain('CAST(`amount` * 0.27 AS DOUBLE) AS `amount_usd`');
    expect(sql).not.toMatch(/`status`,\s*CAST/); // dropped
    expect(sql).toContain('INSERT INTO `big_payments`\nSELECT * FROM `map`;');
  });
  it('two sinks run as one statement set', () => {
    const two: Graph = {
      nodes: [...g.nodes, node('out2', 'Sink', { name: 'all_payments', format: 'json', key: '' })],
      edges: [...g.edges, edge('src', 'out2')],
    };
    const { sql } = toFlinkSql(two);
    // Inserts follow the graph's order; both are inside one set.
    const set = sql.slice(sql.indexOf('EXECUTE STATEMENT SET\nBEGIN\n'));
    expect(sql).toContain('EXECUTE STATEMENT SET\nBEGIN\n');
    expect(set).toContain('INSERT INTO `big_payments`');
    expect(set).toContain('INSERT INTO `all_payments`');
    expect(set.trimEnd().endsWith('END;')).toBe(true);
  });
  it('EXPORT-UNSUPPORTED: a node with no direct SQL (or an expression it can not translate) becomes a TODO comment', () => {
    const bad: Graph = {
      nodes: [
        node('src', 'Source', SRC),
        node('flt', 'Filter', { expr: 'tags.exists(t, t == "x")' }),
        node('q', 'SQL', { query: 'SELECT 1' }),
        node('out', 'Sink', { name: 'o', format: 'json', key: '' }),
      ],
      edges: [edge('src', 'flt'), edge('flt', 'q'), edge('q', 'out')],
    };
    const { sql, unsupported } = toFlinkSql(bad);
    expect(unsupported.map((u) => u.id)).toEqual(['flt', 'q']);
    expect(sql).toContain('-- TODO (EXPORT-UNSUPPORTED)');
  });
  it('route branches, validate rejected and union tags', () => {
    const r: Graph = {
      nodes: [
        node('src', 'Source', SRC),
        node('val', 'Validate', {
          rules: [
            { name: 'positive', expr: 'amount > 0', severity: 'error' },
            { name: 'w', expr: 'amount < 1000', severity: 'warning' },
          ],
        }),
        node('rt', 'Route', {
          routes: [{ id: 'high', name: 'High', expr: 'amount > 500' }],
          defaultBranch: true,
        }),
        node('u', 'Union', { tagField: 'from' }),
        node('out', 'Sink', { name: 'o', format: 'json', key: '' }),
        node('dlq', 'Dead-letter', { reasonField: 'reason', retentionMs: 0 }),
      ],
      edges: [
        edge('src', 'val'),
        edge('val', 'rt'),
        edge('rt', 'u', 'route-high'),
        edge('rt', 'u', 'default'),
        edge('u', 'out'),
        edge('val', 'dlq', 'rejected'),
      ],
    };
    const { sql, unsupported } = toFlinkSql(r);
    expect(unsupported).toEqual([]);
    expect(sql).toContain('WHERE `amount` > 0;'); // warnings do not reject
    expect(sql).toContain('WHERE NOT (`amount` > 0)');
    expect(sql).toContain('WHERE NOT (`amount` > 500)'); // default branch
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain("'positive' AS `reason`");
  });
});
