import { traceRow } from './trace';
import { createRun } from '@sl/engine';
import { PAYMENTS, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { explainPath } from './explain';

const node = (id: string, type: PipelineNode['type'], config: object = {}, label?: string): PipelineNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: config as never,
  ...(label ? { label } : {}),
});
const edge = (s: string, t: string, sh = 'main') => ({
  id: `${s}-${t}-${sh}`,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: 'main',
});
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const pay = (sec: number, card: string, amount: number) => ({
  payment_id: `p${sec}`,
  card_id: card,
  merchant_id: 'm_101',
  amount,
  currency: 'AED',
  status: 'approved',
  event_time: new Date(T0 + sec * 1000).toISOString(),
});
const g = {
  nodes: [
    node(
      's',
      'Source',
      {
        name: 'payments',
        schema: PAYMENTS,
        eventTime: 'event_time',
        outOfOrdernessMs: 5000,
        idleTimeoutMs: 0,
      },
      'payments',
    ),
    node(
      'v',
      'Validate',
      { rules: [{ name: 'positive', expr: 'amount > 0.0', severity: 'error' }] },
      'Rules',
    ),
    node(
      'w',
      'Window',
      {
        kind: 'tumble',
        sizeMs: 300000,
        keyBy: ['card_id'],
        aggregates: [
          { fn: 'count', field: '', as: 'payments' },
          { fn: 'sum', field: 'amount', as: 'amount_sum' },
        ],
        allowedLatenessMs: 0,
      },
      'Bursts per card',
    ),
    node('out', 'Sink', { name: 'fraud_alerts', format: 'json', key: '' }, 'Fraud alerts'),
  ],
  edges: [edge('s', 'v'), edge('v', 'w'), edge('w', 'out')],
};

describe('EXPL-02 explain: the path of one output row, told with its values', () => {
  const r = createRun(g, {
    sourceData: { s: [pay(10, 'c_4471', 980), pay(20, 'c_4471', 960), pay(400, 'c_9', 5)] },
    trace: true,
  });
  r.advance(Infinity);
  const t = r.trace()!;
  const steps = explainPath(g, t, 'out', 0);
  it('walks source → rules → window → sink, one step per node, in order', () => {
    expect(steps.map((s) => s.node)).toEqual(['s', 'v', 'w', 'out']);
    expect(steps.map((s) => s.title)).toEqual([
      'An event arrives',
      'It passes the rules',
      'The window fires',
      'It reaches Fraud alerts',
    ]);
  });
  it('narrates with real values (board E01, E03)', () => {
    expect(steps[0]!.text).toBe(
      'Payment c_4471 · 980.00 enters from payments at event time 12:00:10. It is on time.',
    );
    expect(steps[1]!.text).toBe('All 1 rule passed: positive.');
    expect(steps[2]!.text).toBe(
      'The watermark passes 12:05:00, so window 12:00–12:05 for card_id c_4471 closes: payments 2, amount_sum 1,940.00.',
    );
  });
  it('a row with no lineage (or an unknown sink) explains nothing rather than guessing', () => {
    expect(explainPath(g, t, 'nope', 0)).toEqual([]);
    expect(explainPath(g, t, 'out', 99)).toEqual([]);
  });
});

describe('EXPL-02 audit: narration says what really happened', () => {
  const src = node(
    's',
    'Source',
    { name: 'payments', schema: PAYMENTS, eventTime: 'event_time', outOfOrdernessMs: 5000, idleTimeoutMs: 0 },
    'payments',
  );
  const run = (
    g: { nodes: PipelineNode[]; edges: ReturnType<typeof edge>[] },
    rows: ReturnType<typeof pay>[],
  ) => {
    const r = createRun(g, { sourceData: { s: rows }, trace: true, refTables: {} });
    r.advance(Infinity);
    return r.trace()!;
  };
  it('a filtered-out event, set aside, is not said to pass', () => {
    const g = {
      nodes: [
        src,
        node('f', 'Filter', { expr: 'amount > 10.0' }, 'Big'),
        node('d', 'Dead-letter', { reasonField: 'reason', retentionMs: 0 }, 'Aside'),
      ],
      edges: [edge('s', 'f'), edge('f', 'd', 'rejected')],
    };
    const steps = explainPath(g, run(g, [pay(1, 'c_1', 5)]), 'd', 0);
    expect(steps[1]!.title).toBe('It is filtered out');
  });
  it('a failed rule is named, not "all passed"', () => {
    const g = {
      nodes: [
        src,
        node(
          'v',
          'Validate',
          { rules: [{ name: 'positive', expr: 'amount > 0.0', severity: 'error' }] },
          'Rules',
        ),
        node('d', 'Dead-letter', { reasonField: 'reason', retentionMs: 0 }, 'Aside'),
      ],
      edges: [edge('s', 'v'), edge('v', 'd', 'rejected')],
    };
    const steps = explainPath(g, run(g, [pay(1, 'c_1', -3)]), 'd', 0);
    expect(steps[1]!.text).toBe('Rule positive fails, so it is set aside.');
  });
  it('a lookup miss that passes on is not "joined"', () => {
    const g = {
      nodes: [
        src,
        node(
          'l',
          'Lookup',
          { table: 'merchants', key: 'merchant_id', tableKey: 'merchant_id', asOf: false, onMiss: 'pass' },
          'Merchant',
        ),
        node('out', 'Sink', { name: 'o', format: 'json', key: '' }, 'Out'),
      ],
      edges: [edge('s', 'l'), edge('l', 'out')],
    };
    const rows = [{ ...pay(1, 'c_1', 5), merchant_id: 'm_zzz_unknown' }];
    expect(explainPath(g, run(g, rows), 'out', 0)[1]!.title).toBe('No match');
  });
  it('a disabled node is said to be disabled', () => {
    const g = {
      nodes: [
        src,
        { ...node('f', 'Filter', { expr: 'amount > 1000.0' }, 'Big'), disabled: true },
        node('out', 'Sink', { name: 'o', format: 'json', key: '' }, 'Out'),
      ],
      edges: [edge('s', 'f'), edge('f', 'out')],
    };
    expect(explainPath(g, run(g, [pay(1, 'c_1', 5)]), 'out', 0)[1]!.title).toBe('Big is disabled');
  });
});

describe('EXPL-02 audit 2: an expression that fails at run time', () => {
  it('is said to fail, in Explain and Trace, not to pass', () => {
    const src = node(
      's',
      'Source',
      {
        name: 'payments',
        schema: PAYMENTS,
        eventTime: 'event_time',
        outOfOrdernessMs: 5000,
        idleTimeoutMs: 0,
      },
      'payments',
    );
    const g = {
      nodes: [
        src,
        node('f', 'Filter', { expr: 'int(amount) / 0 > 1' }, 'Big'),
        node('d', 'Dead-letter', { reasonField: 'reason', retentionMs: 0 }, 'Aside'),
      ],
      edges: [edge('s', 'f'), edge('f', 'd', 'rejected')],
    };
    const r = createRun(g, { sourceData: { s: [pay(1, 'c_1', 5)] }, trace: true, refTables: {} });
    r.advance(Infinity);
    const t = r.trace()!;
    expect(explainPath(g, t, 'd', 0)[1]!.title).toBe('Its expression fails');
    expect(traceRow(g, t, 'd', 0)[1]!.text).toMatch(/^Expression failed \(.+\) · set aside$/);
  });
});
