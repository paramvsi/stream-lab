import { createRun } from '@sl/engine';
import { PAYMENTS, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { traceRow } from './trace';

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
      {
        rules: [
          { name: 'a', expr: 'amount > 0.0', severity: 'error' },
          { name: 'b', expr: 'amount < 100000.0', severity: 'error' },
          { name: 'c', expr: 'card_id != ""', severity: 'error' },
        ],
      },
      'Rules',
    ),
    node(
      'w',
      'Window',
      {
        kind: 'tumble',
        sizeMs: 300000,
        keyBy: ['card_id'],
        aggregates: [{ fn: 'count', field: '', as: 'payments' }],
        allowedLatenessMs: 0,
      },
      'Bursts per card',
    ),
    node(
      'r',
      'Route',
      { routes: [{ id: 'hi', name: 'Fraud alerts', expr: 'payments > 2.0' }], defaultBranch: true },
      'Risk score',
    ),
    node('out', 'Sink', { name: 'fraud_alerts', format: 'json', key: '' }, 'Fraud alerts'),
  ],
  edges: [edge('s', 'v'), edge('v', 'w'), edge('w', 'r'), edge('r', 'out', 'route-hi')],
};

describe('EXPL-03 trace: every input and node behind one output row (board E06)', () => {
  const r = createRun(g, {
    sourceData: {
      s: [pay(312, 'c_4471', 1), pay(400, 'c_4471', 2), pay(580, 'c_4471', 3), pay(590, 'c_9', 4)],
    },
    trace: true,
  });
  r.advance(Infinity);
  const t = traceRow(g, r.trace()!, 'out', 0);
  it('lists the contributing nodes in pipeline order, with a summary each', () => {
    expect(t.map((x) => x.node)).toEqual(['s', 'v', 'w', 'r']);
    expect(t.map((x) => x.text)).toEqual([
      '3 events, 12:05:12 to 12:09:40',
      'All 3 passed',
      'Fired at watermark 12:10:00',
      '→ Fraud alerts',
    ]);
  });
  it('an unknown row traces nothing', () => {
    expect(traceRow(g, r.trace()!, 'out', 5)).toEqual([]);
  });
});
