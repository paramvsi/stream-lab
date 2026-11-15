import { beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, historyEntries, PASTE_OFFSET, useGraph } from './store';

const g = () => useGraph.getState();
const t = () => useGraph.temporal.getState();

beforeEach(() => g().load({ id: 'p1', name: 'Card bursts', nodes: [], edges: [] }));

describe('SIM-12 · undo / redo', () => {
  it('each action is one labelled step; undo and redo walk them', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const b = g().addNode('Filter', { x: 200, y: 0 });
    g().connect({ source: a, sourceHandle: 'main', target: b, targetHandle: 'main' });
    expect(historyEntries()).toEqual(['Opened', 'Added Source', 'Added Filter', 'Connected Source → Filter']);
    t().undo();
    expect(g().edges).toHaveLength(0);
    t().redo();
    expect(g().edges).toHaveLength(1);
  });

  it('jumps to any step (undo(n))', () => {
    g().addNode('Source', { x: 0, y: 0 });
    g().addNode('Filter', { x: 0, y: 0 });
    g().addNode('Sink', { x: 0, y: 0 });
    t().undo(3);
    expect(g().nodes).toHaveLength(0);
  });

  it('keeps at most 100 steps', () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) g().addNode('Filter', { x: i, y: 0 });
    expect(t().pastStates).toHaveLength(HISTORY_LIMIT);
  });

  it('a whole drag is one "Moved …" step, and undo restores the start position', () => {
    const a = g().addNode('Window', { x: 0, y: 0 });
    const before = t().pastStates.length;
    g().beginDrag();
    for (let x = 1; x <= 30; x++) g().dragTo({ [a]: { x, y: x } });
    g().endDrag();
    expect(t().pastStates.length).toBe(before + 1);
    expect(historyEntries().at(-1)).toBe('Moved Window');
    t().undo();
    expect(g().nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('a click without movement adds no step', () => {
    g().addNode('Window', { x: 0, y: 0 });
    const before = t().pastStates.length;
    g().beginDrag();
    g().endDrag();
    expect(t().pastStates.length).toBe(before);
  });

  it('selection changes are not undo steps', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const before = t().pastStates.length;
    g().select([]);
    g().select([a]);
    expect(t().pastStates.length).toBe(before);
  });

  it('SIM-UNDO-EMPTY: nothing to undo right after opening', () => {
    expect(t().pastStates).toHaveLength(0);
  });
});

describe('SIM-08 / SIM-09 · quick-add from a handle, insert on edge', () => {
  it('SIM-08 adding from an output handle auto-connects the new node', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const b = g().addNode('Filter', { x: 200, y: 0 }, { nodeId: a, handleId: 'main' });
    expect(g().edges).toMatchObject([{ source: a, sourceHandle: 'main', target: b, targetHandle: 'main' }]);
  });

  it('SIM-08 adding from an input handle connects the new node into it', () => {
    const k = g().addNode('Sink', { x: 400, y: 0 });
    const f = g().addNode('Filter', { x: 200, y: 0 }, { nodeId: k, handleId: 'main', fromTarget: true });
    expect(g().edges).toMatchObject([{ source: f, target: k }]);
  });

  it('SIM-09 insert on edge splices the node in as one undo step', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const b = g().addNode('Sink', { x: 400, y: 0 });
    g().connect({ source: a, sourceHandle: 'main', target: b, targetHandle: 'main' });
    const steps = t().pastStates.length;
    const n = g().insertOnEdge(g().edges[0]!.id, 'Filter');
    expect(g().edges.map((e) => [e.source, e.target])).toEqual([
      [a, n],
      [n, b],
    ]);
    expect(g().nodes.find((x) => x.id === n)!.position).toEqual({ x: 200, y: 0 });
    expect(t().pastStates.length).toBe(steps + 1);
    t().undo();
    expect(g().edges.map((e) => [e.source, e.target])).toEqual([[a, b]]);
  });
});

describe('SIM-11 · multi-select, delete, copy and paste', () => {
  it('pastes with +24 px offset, new ids, and only the internal edges', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const b = g().addNode('Filter', { x: 200, y: 0 });
    const c = g().addNode('Sink', { x: 400, y: 0 });
    g().connect({ source: a, sourceHandle: 'main', target: b, targetHandle: 'main' });
    g().connect({ source: b, sourceHandle: 'main', target: c, targetHandle: 'main' });
    g().select([a, b]);
    g().copySelection();
    const pasted = g().paste();
    expect(pasted).toHaveLength(2);
    expect(pasted).not.toContain(a);
    const p = g().nodes.filter((n) => pasted.includes(n.id));
    expect(p.map((n) => n.position)).toEqual([
      { x: PASTE_OFFSET, y: PASTE_OFFSET },
      { x: 200 + PASTE_OFFSET, y: PASTE_OFFSET },
    ]);
    const newEdges = g().edges.filter((e) => pasted.includes(e.source));
    expect(newEdges).toHaveLength(1); // a→b copied; b→c (to an unselected node) not
    expect(g().selected).toEqual(pasted);
  });

  it('a second paste lands one more offset away', () => {
    g().addNode('Source', { x: 0, y: 0 });
    g().copySelection();
    g().paste();
    const second = g().paste();
    expect(g().nodes.find((n) => n.id === second[0])!.position).toEqual({ x: 48, y: 48 });
  });

  it('SIM-DELETE-UNDO: delete returns the count, removes attached edges, and undo restores both', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const b = g().addNode('Filter', { x: 200, y: 0 });
    g().connect({ source: a, sourceHandle: 'main', target: b, targetHandle: 'main' });
    g().select([a, b]);
    expect(g().deleteSelection()).toBe(2);
    expect(g().edges).toHaveLength(0);
    expect(historyEntries().at(-1)).toBe('Deleted 2 nodes');
    t().undo();
    expect(g().nodes).toHaveLength(2);
    expect(g().edges).toHaveLength(1);
  });

  it('duplicate offsets copies and selects them', () => {
    const a = g().addNode('Window', { x: 10, y: 10 });
    const [d] = g().duplicate([a]);
    expect(g().nodes.find((n) => n.id === d)!.position).toEqual({ x: 34, y: 34 });
    expect(g().selected).toEqual([d]);
  });

  it('toggleDisabled labels the step', () => {
    const a = g().addNode('Window', { x: 0, y: 0 });
    g().toggleDisabled([a]);
    expect(historyEntries().at(-1)).toBe('Disabled Window');
    g().toggleDisabled([a]);
    expect(historyEntries().at(-1)).toBe('Enabled Window');
  });
});
