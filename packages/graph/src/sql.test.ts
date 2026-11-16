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

const SCHEMA = [
  ...PAYMENTS,
  { name: 'fee', type: 'number' as const, required: true },
  { name: 'count', type: 'number' as const, required: true },
];
describe('EXP-01 CEL to Flink SQL', () => {
  it('translates the plain subset, every operation parenthesised', () => {
    expect(celToSql('amount > 3.5 && status == "approved"')).toBe(
      "((`amount` > 3.5) AND (`status` = 'approved'))",
    );
    expect(celToSql('!(a || b) ? 1 : 2')).toBe('(CASE WHEN (NOT (`a` OR `b`)) THEN 1 ELSE 2 END)');
    expect(celToSql('currency in ["AED", "USD"]')).toBe("(`currency` IN ('AED', 'USD'))");
    expect(celToSql('x == null')).toBe('(`x` IS NULL)');
    expect(celToSql('size(card_id) > 0')).toBe('(CHAR_LENGTH(`card_id`) > 0)');
    expect(celToSql('merchant_id.startsWith("m1")')).toBe("(`merchant_id` LIKE 'm1%')");
    expect(celToSql('name == "o\'hara"')).toBe("(`name` = 'o''hara')");
    expect(celToSql('7 % 2 == 1')).toBe('(MOD(7, 2) = 1)'); // CEL % is on ints
  });
  it('anything else is not guessed (null)', () => {
    expect(celToSql('tags.exists(t, t == "x")')).toBeNull();
    expect(celToSql('timestamp("2026-01-01T00:00:00Z") < event_time')).toBeNull();
    expect(celToSql('amount >')).toBeNull();
  });
});

describe('EXP-01 SQL export audit (52a0095)', () => {
  it('#1 grouping survives: arithmetic keeps its parentheses, and unary minus never makes a "--" comment', () => {
    expect(celToSql('(amount + 1.0) * 2.0', SCHEMA)).toBe('((`amount` + 1.0) * 2.0)');
    expect(celToSql('-(amount - 1.0)', SCHEMA)).toBe('(-(`amount` - 1.0))');
    expect(celToSql('amount - (fee - 1.0)', SCHEMA)).toBe('(`amount` - (`fee` - 1.0))');
    expect(celToSql('-(-amount)', SCHEMA)).toBe('(-(-`amount`))');
    expect(celToSql('- -1', SCHEMA)).not.toContain('--');
  });
  it('#8 string + is concatenation (||); a + of unknown types is not guessed', () => {
    expect(celToSql('"c_" + card_id', SCHEMA)).toBe("('c_' || `card_id`)");
    expect(celToSql('a + b')).toBeNull();
  });
  it('#9 no LIKE ... ESCAPE (unsupported in Flink 1.20): a literal with % or _ is not translated', () => {
    expect(celToSql('merchant_id.startsWith("m_1")')).toBeNull();
  });
  it('doubles stay decimals (7.0 / 2.0 is 3.5 in SQL too)', () => {
    expect(celToSql('7.0 / 2.0')).toBe('(7.0 / 2.0)');
  });
});

describe('EXP-01 Flink SQL export (sources, filter, map, route, union, validate, sinks)', () => {
  const g: Graph = {
    nodes: [
      node('src', 'Source', SRC),
      node('flt', 'Filter', { expr: 'amount > 100.0' }, 'Big ones'),
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
      'CREATE TEMPORARY VIEW `big_ones` AS\nSELECT * FROM `payments`\nWHERE (`amount` > 100.0) IS TRUE;',
    );
    expect(sql).toContain('CAST((`amount` * 0.27) AS DOUBLE) AS `amount_usd`');
    expect(sql).not.toMatch(/`status`,\s*CAST/); // dropped
    expect(sql).toContain(
      'INSERT INTO `big_payments`\nSELECT `payment_id`, `card_id`, `merchant_id`, `amount`, `currency`, `event_time`, `amount_usd` FROM `map`;',
    );
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
    expect(unsupported.map((u) => u.id)).toEqual(['flt']); // q reads flt: left out, not guessed
    expect(sql).toContain('-- TODO (EXPORT-UNSUPPORTED)');
    // Nothing after a TODO is guessed: the sink reading it is left out, not fed a pass-through view.
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).toContain('-- Left out: SQL reads flt');
  });
  it('route branches, validate rejected and union tags', () => {
    const r: Graph = {
      nodes: [
        node('src', 'Source', SRC),
        node('val', 'Validate', {
          rules: [
            { name: 'positive', expr: 'amount > 0.0', severity: 'error' },
            { name: 'w', expr: 'amount < 1000.0', severity: 'warning' },
          ],
        }),
        node('rt', 'Route', {
          routes: [{ id: 'high', name: 'High', expr: 'amount > 500.0' }],
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
    // Every rule rejects, as in the simulator (D37); NULL (a malformed row) fails a rule, it is not lost.
    expect(sql).toContain('WHERE (`amount` > 0.0) IS TRUE AND (`amount` < 1000.0) IS TRUE;');
    expect(sql).toContain('WHERE NOT ((`amount` > 0.0) IS TRUE AND (`amount` < 1000.0) IS TRUE)');
    expect(sql).toContain('WHERE (`amount` > 500.0) IS NOT TRUE;'); // default branch
    expect(sql).toContain('UNION ALL');
    // #2 the dead letter's reason goes in the configured field, and the columns line up.
    expect(sql).toContain(
      "CASE WHEN (`amount` > 0.0) IS NOT TRUE THEN 'positive' WHEN (`amount` < 1000.0) IS NOT TRUE THEN 'w' END AS `reason`",
    );
  });
});

describe('EXP-01 Flink SQL export part 2 (windows, joins, lookups, dedup, top-N)', () => {
  const MERCHANTS = [
    { name: 'merchant_id', type: 'string' as const, required: true },
    { name: 'risk_tier', type: 'string' as const, required: true },
    { name: 'valid_from', type: 'timestamp' as const, required: true },
  ];
  const sink = node('out', 'Sink', { name: 'o', format: 'json', key: '' });
  const one = (mid: PipelineNode) =>
    toFlinkSql(
      { nodes: [node('src', 'Source', SRC), mid, sink], edges: [edge('src', mid.id), edge(mid.id, 'out')] },
      { refTables: { merchants: MERCHANTS, flags: MERCHANTS.slice(0, 2) } },
    );
  it('tumble / hop / session windows as TVFs on the rowtime, aggregates cast to the schema', () => {
    const t = one(
      node('w', 'Window', {
        kind: 'tumble',
        sizeMs: 300000,
        keyBy: ['card_id'],
        aggregates: [
          { fn: 'count', field: '', as: 'payments' },
          { fn: 'sum', field: 'amount', as: 'total' },
        ],
        allowedLatenessMs: 0,
      }),
    );
    expect(t.unsupported).toEqual([]);
    expect(t.sql).toContain(
      "FROM TABLE(TUMBLE(TABLE `payments`, DESCRIPTOR(`event_time`), INTERVAL '5' MINUTE))",
    );
    expect(t.sql).toContain(
      'CAST(COUNT(*) AS DOUBLE) AS `payments`, CAST(SUM(`amount`) AS DOUBLE) AS `total`',
    );
    expect(t.sql).toContain('GROUP BY `card_id`, `window_start`, `window_end`, `window_time`');
    expect(t.sql).toContain(
      'INSERT INTO `o`\nSELECT `card_id`, `window_start`, `window_end`, `payments`, `total` FROM `w`;',
    );
    expect(
      one(
        node('w', 'Window', {
          kind: 'hop',
          sizeMs: 60000,
          slideMs: 10000,
          keyBy: [],
          aggregates: [],
          allowedLatenessMs: 0,
        }),
      ).sql,
    ).toContain("HOP(TABLE `payments`, DESCRIPTOR(`event_time`), INTERVAL '10' SECOND, INTERVAL '1' MINUTE)");
    expect(
      one(
        node('w', 'Window', {
          kind: 'session',
          gapMs: 30000,
          keyBy: ['card_id'],
          aggregates: [],
          allowedLatenessMs: 0,
        }),
      ).sql,
    ).toContain(
      "SESSION(TABLE `payments` PARTITION BY `card_id`, DESCRIPTOR(`event_time`), INTERVAL '30' SECOND)",
    );
  });
  it('allowed lateness has no SQL: the window is exported and flagged (EXPORT-UNSUPPORTED)', () => {
    const r = one(
      node('w', 'Window', {
        kind: 'tumble',
        sizeMs: 60000,
        keyBy: [],
        aggregates: [],
        allowedLatenessMs: 5000,
      }),
    );
    expect(r.unsupported.map((u) => u.id)).toEqual(['w']);
    expect(r.sql).toContain('TUMBLE(');
  });
  it("interval join with the simulator's bound; a regular join says its state grows", () => {
    const j = (lo: number | null, hi: number | null) =>
      toFlinkSql({
        nodes: [
          node('a', 'Source', SRC),
          node('b', 'Source', { ...SRC, name: 'refunds' }),
          node('j', 'Join', {
            kind: 'inner',
            leftKey: 'card_id',
            rightKey: 'card_id',
            lowerMs: lo,
            upperMs: hi,
          }),
          sink,
        ],
        edges: [edge('a', 'j', 'main', 'left'), edge('b', 'j', 'main', 'right'), edge('j', 'out')],
      }).sql;
    expect(j(-600000, 0)).toContain(
      "AND R.`event_time` BETWEEN L.`event_time` - INTERVAL '10' MINUTE AND L.`event_time`",
    );
    expect(j(-600000, 0)).toContain('R.`card_id` AS `right_card_id`');
    expect(j(null, null)).toContain('-- Regular join: no time bound');
  });
  it('lookups: as-of on a versioned table (event time), processing time otherwise; reject sends misses aside', () => {
    const asOf = one(
      node('l', 'Lookup', {
        table: 'merchants',
        key: 'merchant_id',
        tableKey: 'merchant_id',
        asOf: true,
        onMiss: 'pass',
      }),
    );
    expect(asOf.sql).toContain('LEFT JOIN `merchants` FOR SYSTEM_TIME AS OF E.`event_time` AS T');
    expect(asOf.sql).toContain('PRIMARY KEY (`merchant_id`) NOT ENFORCED,\n  WATERMARK FOR `valid_from`');
    const proc = one(
      node('l', 'Lookup', {
        table: 'flags',
        key: 'merchant_id',
        tableKey: 'merchant_id',
        asOf: false,
        onMiss: 'drop',
      }),
    );
    expect(proc.sql).toContain('PROCTIME() AS `proc_time`');
    expect(proc.sql).toContain('\nJOIN `flags` FOR SYSTEM_TIME AS OF E.`proc_time` AS T');
  });
  it('dedup by ROW_NUMBER over the rowtime; top-N within a window partitions by it', () => {
    const d = one(node('d', 'Deduplicate', { key: ['payment_id'], keep: 'first', ttlMs: 3600000 })).sql;
    expect(d).toContain('ROW_NUMBER() OVER (PARTITION BY `payment_id` ORDER BY `event_time` ASC) AS `rn`');
    expect(d).toContain('WHERE `rn` = 1');
    const top = toFlinkSql({
      nodes: [
        node('src', 'Source', SRC),
        node('w', 'Window', {
          kind: 'tumble',
          sizeMs: 60000,
          keyBy: ['merchant_id'],
          aggregates: [{ fn: 'sum', field: 'amount', as: 'revenue' }],
          allowedLatenessMs: 0,
        }),
        node('t', 'Top-N', { partitionBy: [], orderBy: 'revenue', desc: true, n: 3, withinWindow: true }),
        sink,
      ],
      edges: [edge('src', 'w'), edge('w', 't'), edge('t', 'out')],
    });
    expect(top.unsupported).toEqual([]);
    expect(top.sql).toContain(
      'ROW_NUMBER() OVER (PARTITION BY `window_start`, `window_end` ORDER BY `revenue` DESC) AS `rn`',
    );
    expect(top.sql).toContain('WHERE `rn` <= 3');
  });
});

describe('EXP-01 SQL export audit (52a0095): graph-level', () => {
  const sink = (id: string, name: string) => node(id, 'Sink', { name, format: 'json', key: '' });
  it('#2 Dead-letter uses its reason field and adds exactly one column', () => {
    const { sql } = toFlinkSql({
      nodes: [
        node('src', 'Source', SRC),
        node('val', 'Validate', { rules: [{ name: 'pos', expr: 'amount > 0.0', severity: 'error' }] }),
        sink('o', 'o'),
        node('dlq', 'Dead-letter', { reasonField: 'why', retentionMs: 0 }),
      ],
      edges: [edge('src', 'val'), edge('val', 'o'), edge('val', 'dlq', 'rejected')],
    });
    const ddl = sql.slice(sql.indexOf('CREATE TABLE `dlq_val_rejected`'));
    expect(ddl.slice(0, ddl.indexOf(') WITH'))).toContain('`why` STRING');
    expect(sql).toMatch(/SELECT `payment_id`, [^\n]*, CASE WHEN [^\n]* END AS `why` FROM `val_rejected`;/);
  });
  it('#3 a Filter rejected output is exported with the simulator reason', () => {
    const { sql } = toFlinkSql({
      nodes: [
        node('src', 'Source', SRC),
        node('f', 'Filter', { expr: 'amount > 1.0' }),
        sink('o', 'o'),
        node('dlq', 'Dead-letter', { reasonField: 'reason', retentionMs: 0 }),
      ],
      edges: [edge('src', 'f'), edge('f', 'o'), edge('f', 'dlq', 'rejected')],
    });
    expect(sql).toContain(
      'CREATE TEMPORARY VIEW `f_rejected` AS\nSELECT * FROM `payments`\nWHERE (`amount` > 1.0) IS NOT TRUE;',
    );
    expect(sql).toContain("'filtered out' AS `reason` FROM `f_rejected`;");
  });
  it('#4 tables keep their configured names (and topics); a view never takes a table name', () => {
    const { sql } = toFlinkSql({
      nodes: [
        node('src', 'Source', SRC),
        node('w', 'Filter', { expr: 'amount > 1.0' }, 'Per currency'),
        sink('o', 'per_currency'),
        sink('o2', 'Fraud-Alerts.v1'),
      ],
      edges: [edge('src', 'w'), edge('w', 'o'), edge('src', 'o2')],
    });
    expect(sql).toContain('CREATE TABLE `per_currency` (');
    expect(sql).toContain("'topic' = 'per_currency'");
    expect(sql).toContain('CREATE TEMPORARY VIEW `per_currency_2` AS');
    expect(sql).toContain("'topic' = 'Fraud-Alerts.v1'");
  });
  it('#6 side-output view names are unique too', () => {
    const { sql } = toFlinkSql({
      nodes: [
        node('src', 'Source', SRC),
        node(
          'r',
          'Route',
          { routes: [{ id: 'high', name: 'H', expr: 'amount > 1.0' }], defaultBranch: false },
          'Velocity',
        ),
        node('f', 'Filter', { expr: 'amount > 2.0' }, 'Velocity high'),
        sink('o', 'a'),
        sink('o2', 'b'),
      ],
      edges: [edge('src', 'r'), edge('src', 'f'), edge('r', 'o', 'route-high'), edge('f', 'o2')],
    });
    expect(sql.match(/CREATE TEMPORARY VIEW `velocity_high` AS/g)).toHaveLength(1);
  });
  it('#7 disabled nodes: the first output passes the input on; a disabled source and a sink with no input write nothing', () => {
    const { sql } = toFlinkSql({
      nodes: [
        node('src', 'Source', SRC),
        {
          ...node('r', 'Route', {
            routes: [{ id: 'r1', name: 'R1', expr: 'amount > 1.0' }],
            defaultBranch: true,
          }),
          disabled: true,
        },
        sink('o', 'a'),
        sink('o2', 'b'),
        sink('o3', 'lonely'),
      ],
      edges: [edge('src', 'r'), edge('r', 'o', 'route-r1'), edge('r', 'o2', 'default')],
    });
    expect(sql).toContain('CREATE TEMPORARY VIEW `r_r1` AS\nSELECT * FROM `payments`;');
    expect(sql).toContain('INSERT INTO `a`');
    expect(sql).not.toContain('INSERT INTO `b`');
    expect(sql).not.toContain('CREATE TABLE `lonely`');
    const off = toFlinkSql({
      nodes: [{ ...node('src', 'Source', SRC), disabled: true }, sink('o', 'a')],
      edges: [edge('src', 'o')],
    });
    expect(off.sql).not.toContain('INSERT INTO');
  });
  it('#10 Kafka JSON reads ISO-8601 times; columns are nullable (malformed rows)', () => {
    const { sql } = toFlinkSql({
      nodes: [node('src', 'Source', SRC), sink('o', 'a')],
      edges: [edge('src', 'o')],
    });
    expect(sql).toContain("'json.timestamp-format.standard' = 'ISO-8601'");
    expect(sql).not.toContain('NOT NULL');
  });
  it('a watermark under a second is kept (400 ms), not rounded to 0', () => {
    const { sql } = toFlinkSql({
      nodes: [node('src', 'Source', { ...SRC, outOfOrdernessMs: 400 }), sink('o', 'a')],
      edges: [edge('src', 'o')],
    });
    expect(sql).toContain("- INTERVAL '0.400' SECOND");
  });
  it('a union tag named like a column replaces it (one column)', () => {
    const { sql } = toFlinkSql({
      nodes: [
        node('a', 'Source', SRC),
        node('b', 'Source', { ...SRC, name: 'more' }),
        node('u', 'Union', { tagField: 'status' }),
        sink('o', 'x'),
      ],
      edges: [edge('a', 'u'), edge('b', 'u'), edge('u', 'o')],
    });
    for (const line of sql.split('\n').filter((l) => l.includes(' AS `status`')))
      expect(line.match(/`status`/g)).toHaveLength(1);
  });
});
