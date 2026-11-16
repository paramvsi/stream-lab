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
