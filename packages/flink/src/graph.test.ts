import { describe, expect, it } from 'vitest';
import { graphLayers, jobGraph } from './graph';

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
      { from: 's', to: 'w', ship: 'HASH', num: 0 },
      { from: 'w', to: 'k', ship: null, num: 0 },
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

  it('one vertex reading the same upstream twice (a self-join) gives two edges told apart by num', () => {
    const p = {
      ...plan,
      nodes: [
        plan.nodes[0],
        {
          ...plan.nodes[1]!,
          inputs: [
            { num: 0, id: 's', ship_strategy: 'HASH', exchange: 'x' },
            { num: 1, id: 's', ship_strategy: 'HASH', exchange: 'x' },
          ],
        },
      ],
    };
    const keys = jobGraph(detail(p)).edges.map((e) => `${e.from}-${e.to}-${e.num}`);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('JOB-02 · graph layers (columns, left to right)', () => {
  const g = (nodes: string[], edges: [string, string][]) => ({
    nodes: nodes.map((id) => ({ id, name: id, parallelism: 1, status: 'RUNNING' })),
    edges: edges.map(([from, to], num) => ({ from, to, ship: null, num })),
  });

  it('a chain is one node per column, in flow order', () => {
    expect(
      graphLayers(
        g(
          ['k', 'w', 's'],
          [
            ['s', 'w'],
            ['w', 'k'],
          ],
        ),
      ),
    ).toEqual([['s'], ['w'], ['k']]);
  });

  it('a node goes one column after its deepest input (a join waits for its longest branch)', () => {
    const layers = graphLayers(
      g(
        ['a', 'b', 'c', 'j'],
        [
          ['a', 'b'],
          ['b', 'j'],
          ['c', 'j'],
        ],
      ),
    );
    expect(layers).toEqual([['a', 'c'], ['b'], ['j']]);
  });

  it('no edges (a plan that did not parse): one column with every node, never a crash', () => {
    expect(graphLayers(g(['x', 'y'], []))).toEqual([['x', 'y']]);
  });

  it('a cycle (impossible in a job graph, but never hang) still places every node once', () => {
    const layers = graphLayers(
      g(
        ['a', 'b'],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    );
    expect(layers.flat().sort()).toEqual(['a', 'b']);
  });

  it('sources: only vertices the plan lists with no inputs (none from a missing, partial or odd plan)', () => {
    expect(jobGraph(detail(undefined)).sources).toEqual([]);
    expect(jobGraph(detail({ nodes: [] })).sources).toEqual([]);
    const g = jobGraph(detail({ nodes: [{ id: 's' }, { id: 'w', inputs: [{ id: 'gone', num: 0 }] }] }));
    expect(g.sources).toEqual(['s']); // w has an input (even one not among the vertices): not a source
  });
});
