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

describe('EXPL-03 audit: big fan-in and side ports', () => {
  const hop = (
    id: number,
    n: string,
    parents: number[],
    port = 'main',
    data: Record<string, unknown> = {},
  ) => ({
    id,
    node: n,
    port,
    parents,
    ts: 1000 + id,
    data,
    reason: undefined,
    watermark: 0,
    at: id,
  });
  const g = {
    nodes: [
      node('s', 'Source'),
      node('w', 'Window', { keyBy: [] }),
      node('f', 'Filter', { expr: 'amount > 1.0' }),
      node('o', 'Sink'),
    ],
    edges: [edge('s', 'w'), edge('w', 'f'), edge('f', 'o', 'rejected')],
  };
  it('a window of 200,000 events traces without a stack overflow, quickly', () => {
    const N = 200_000;
    const hops = new Map<number, ReturnType<typeof hop>>();
    const ids: number[] = [];
    for (let i = 1; i <= N; i++) {
      hops.set(i, hop(i, 's', []));
      ids.push(i);
    }
    hops.set(N + 1, hop(N + 1, 'w', ids, 'main', { window_end: '2026-01-01T00:05:00.000Z' }));
    hops.set(N + 2, hop(N + 2, 'f', [N + 1], 'rejected'));
    const t0 = performance.now();
    const steps = traceRow(g, { hops, outputs: { o: [N + 2] } } as never, 'o', 0);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(steps[0]!.count).toBe(N);
    // A rejected event is not said to pass.
    expect(steps[2]!.text).toBe('amount > 1.0 · set aside');
  });
});
