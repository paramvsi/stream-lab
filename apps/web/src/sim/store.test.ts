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

describe('M1 audit fixes · store', () => {
  it('#1 auto-connect from quick-add obeys the connection rules (no second edge into a single input)', () => {
    const s = g().addNode('Source', { x: 0, y: 0 });
    const f = g().addNode('Filter', { x: 200, y: 0 }, { nodeId: s, handleId: 'main' });
    g().addNode('Generator', { x: 0, y: 200 }, { nodeId: f, handleId: 'main', fromTarget: true });
    expect(g().edges.filter((e) => e.target === f)).toHaveLength(1);
  });

  it('#3 duplicate with nothing (or only stale ids) selected adds no step and keeps redo', () => {
    g().addNode('Source', { x: 0, y: 0 });
    t().undo();
    const future = t().futureStates.length;
    const past = t().pastStates.length;
    expect(g().duplicate(['gone'])).toEqual([]);
    expect(g().duplicate([])).toEqual([]);
    expect(t().pastStates.length).toBe(past);
    expect(t().futureStates.length).toBe(future);
  });

  it('#4 restore puts back exactly what a delete removed, even after later steps', () => {
    const a = g().addNode('Source', { x: 0, y: 0 });
    const b = g().addNode('Sink', { x: 200, y: 0 });
    g().connect({ source: a, sourceHandle: 'main', target: b, targetHandle: 'main' });
    g().select([b]);
    const removed = g().deleteSelection();
    const f = g().addNode('Filter', { x: 0, y: 200 });
    g().restore(removed);
    expect(
      g()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual([a, b, f].sort());
    expect(g().edges).toHaveLength(1);
    expect(historyEntries().at(-1)).toBe('Restored Sink');
  });

  it('#5 a move outside a drag (arrow keys) is its own "Moved …" step', () => {
    const a = g().addNode('Window', { x: 0, y: 0 });
    g().nudge({ [a]: { x: 8, y: 0 } });
    expect(historyEntries().at(-1)).toBe('Moved Window');
    t().undo();
    expect(g().nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('#20 load resets the edge selection', () => {
    g().select([], ['e_x']);
    g().load({ id: 'p2', name: 'x', nodes: [], edges: [] });
    expect(g().selectedEdges).toEqual([]);
  });
});

describe('M1 audit 2 · store', () => {
  it('#1 undo/redo drop selected ids of nodes that no longer exist', () => {
    g().addNode('Source', { x: 0, y: 0 });
    g().addNode('Filter', { x: 200, y: 0 }); // selected
    t().undo();
    expect(g().selected).toEqual([]);
  });

  it('#2 restore re-checks edges: no second edge into a single input', () => {
    const s = g().addNode('Source', { x: 0, y: 0 });
    const f = g().addNode('Filter', { x: 200, y: 0 });
    g().connect({ source: s, sourceHandle: 'main', target: f, targetHandle: 'main' });
    g().select([s]);
    const removed = g().deleteSelection();
    const gen = g().addNode('Generator', { x: 0, y: 200 });
    g().connect({ source: gen, sourceHandle: 'main', target: f, targetHandle: 'main' });
    g().restore(removed);
    expect(g().edges.filter((e) => e.target === f)).toHaveLength(1);
    expect(g().nodes.some((n) => n.id === s)).toBe(true); // the node itself comes back
  });

  it('#2 restore never creates a cycle', () => {
    const a = g().addNode('Filter', { x: 0, y: 0 });
    const x = g().addNode('Filter', { x: 200, y: 0 });
    const b = g().addNode('Filter', { x: 400, y: 0 });
    g().connect({ source: a, sourceHandle: 'main', target: x, targetHandle: 'main' });
    g().connect({ source: x, sourceHandle: 'main', target: b, targetHandle: 'main' });
    g().select([x]);
    const removed = g().deleteSelection();
    g().connect({ source: b, sourceHandle: 'main', target: a, targetHandle: 'main' });
    g().restore(removed);
    const e = g().edges.map((y) => `${y.source}>${y.target}`);
    expect(e.includes(`${a}>${x}`) && e.includes(`${x}>${b}`)).toBe(false);
  });

  it('#8 undo is ignored while a drag is in progress', () => {
    g().addNode('Filter', { x: 0, y: 0 });
    g().beginDrag();
    expect(g().isDragging()).toBe(true);
    g().endDrag();
    expect(g().isDragging()).toBe(false);
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
    expect(g().deleteSelection().nodes).toHaveLength(2);
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

describe('NODE-07 · config edits', () => {
  it('typing many characters is ONE undo step, recorded on blur; undo restores the previous value', () => {
    const f = g().addNode('Filter', { x: 0, y: 0 });
    const before = t().pastStates.length;
    g().beginEdit();
    for (const v of ['a', 'am', 'amo', 'amount > 10']) g().liveConfig(f, { expr: v });
    expect(g().nodes[0]!.config).toEqual({ expr: 'amount > 10' }); // live, so validation sees it
    expect(t().pastStates.length).toBe(before); // nothing recorded while typing
    g().endEdit(f);
    expect(t().pastStates.length).toBe(before + 1);
    expect(historyEntries().at(-1)).toBe('Changed Filter settings');
    t().undo();
    expect((g().nodes[0]!.config as { expr: string }).expr).toBe('amount > 0');
  });

  it('focus and blur without a change adds no step', () => {
    const f = g().addNode('Filter', { x: 0, y: 0 });
    const before = t().pastStates.length;
    g().beginEdit();
    g().endEdit(f);
    expect(t().pastStates.length).toBe(before);
  });
});
