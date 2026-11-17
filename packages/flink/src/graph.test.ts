import { describe, expect, it } from 'vitest';
import { jobGraph } from './graph';

const v = (id: string, name: string, parallelism: number, status = 'RUNNING') => ({
  id,
  name,
  parallelism,
  'start-time': 1,
  'end-time': -1,
  duration: 1,
  status,
});
const detail = (plan: unknown) => ({
  jid: 'j',
  name: 'refund-matcher',
  state: 'RUNNING',
  'start-time': 1,
  'end-time': -1,
  duration: 1,
  now: 2,
  vertices: [
    v('s', 'Source: payments', 4),
    v('w', 'Window aggregate', 4),
    v('k', 'Sink: alerts', 2, 'FAILED'),
  ],
  plan,
});
const plan = {
  jid: 'j',
  name: 'refund-matcher',
  type: 'STREAMING',
  nodes: [
    {
      id: 's',
      parallelism: 4,
      operator: '',
      operator_strategy: '',
      description: 'Source: payments',
      optimizer_properties: {},
    },
    {
      id: 'w',
      parallelism: 4,
      operator: '',
      operator_strategy: '',
      description: 'Window &amp; aggregate',
      inputs: [{ num: 0, id: 's', ship_strategy: 'HASH', exchange: 'pipelined_bounded' }],
      optimizer_properties: {},
    },
    {
      id: 'k',
      parallelism: 2,
      operator: '',
      operator_strategy: '',
      description: 'Sink: alerts',
      inputs: [{ num: 0, id: 'w', exchange: 'pipelined_bounded' }],
      optimizer_properties: {},
    },
  ],
};

describe('JOB-02 · job graph from the plan (board D08)', () => {
  it('nodes are the vertices (names from the vertex, not the HTML-escaped plan text), with parallelism and status', () => {
    const g = jobGraph(detail(plan));
    expect(g.nodes).toEqual([
      { id: 's', name: 'Source: payments', parallelism: 4, status: 'RUNNING' },
      { id: 'w', name: 'Window aggregate', parallelism: 4, status: 'RUNNING' },
      { id: 'k', name: 'Sink: alerts', parallelism: 2, status: 'FAILED' },
    ]);
  });

  it("edges come from each node's inputs, with the ship strategy when Flink gives one", () => {
    expect(jobGraph(detail(plan)).edges).toEqual([
      { from: 's', to: 'w', ship: 'HASH' },
      { from: 'w', to: 'k', ship: null },
    ]);
  });

  it('a plan Flink did not send, or one that does not parse, gives the vertices with no edges (never a crash)', () => {
    expect(jobGraph(detail(undefined)).edges).toEqual([]);
    expect(jobGraph(detail({ nodes: 'x' })).nodes).toHaveLength(3);
  });

  it('an input naming a vertex that is not there is dropped', () => {
    const p = {
      ...plan,
      nodes: [plan.nodes[0], { ...plan.nodes[1]!, inputs: [{ num: 0, id: 'gone', exchange: 'x' }] }],
    };
    expect(jobGraph(detail(p)).edges).toEqual([]);
  });
});
