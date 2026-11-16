import { spec, type Graph, type NodeType, type PipelineNode } from '@sl/graph';
import { describe, expect, it } from 'vitest';
import { Driver, type DriverMessage } from './driver';

const node = (id: string, type: NodeType, config: object = {}): PipelineNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  config: { ...(spec(type).defaults() as object), ...config },
});
// Generator at 50/s: one arrival every 20 ms of simulation clock.
const g: Graph = {
  nodes: [node('gen', 'Generator', { count: 100, duplicatePct: 0 }), node('out', 'Sink')],
  edges: [{ id: 'e', source: 'gen', sourceHandle: 'main', target: 'out', targetHandle: 'main' }],
};
const setup = (wall = () => 0) => {
  const msgs: DriverMessage[] = [];
  const d = new Driver(g, {}, (m) => msgs.push(m), wall);
  const last = () =>
    msgs.filter((m) => m.type === 'stats').at(-1) as Extract<DriverMessage, { type: 'stats' }>;
  return { d, msgs, last };
};

describe('SIM-16 · run controls', () => {
  it('runs on the simulation clock: one 100 ms tick at 1× processes 100 ms of arrivals; speed scales it', () => {
    const { d, last } = setup();
    d.play();
    d.tick();
    expect(last().stats.processed).toBe(6); // arrivals at 0, 20, … 100 ms
    d.setSpeed(4);
    d.tick();
    expect(last().stats.processed).toBe(26); // clock 500 ms
  });

  it('pause stops ticks; step processes exactly one event; reset starts over', () => {
    const { d, last } = setup();
    d.play();
    d.tick();
    d.pause();
    d.tick();
    expect(last().stats.processed).toBe(6);
    d.step();
    expect([last().state, last().stats.processed]).toEqual(['paused', 7]);
    d.reset();
    expect([last().state, last().stats.processed]).toEqual(['ready', 0]);
  });

  it('finishes at the end of input and flushes the final watermark', () => {
    const { d, last } = setup();
    d.setSpeed(100);
    d.play();
    d.tick();
    expect(last().state).toBe('finished');
    expect(last().stats.done).toBe(true);
    expect(last().stats.outputs['out']).toHaveLength(100);
  });

  it('posts one stats message per tick, never one per event (ENG-01 batching)', () => {
    const { d, msgs } = setup();
    d.setSpeed(10);
    d.play();
    const before = msgs.length;
    d.tick();
    expect(msgs.length - before).toBe(1);
  });
});

describe('SIM-SLOW · SIM-ENGINE-CRASH', () => {
  it('SIM-SLOW once, after ticks below 20 % of the target rate for 5 s (catalog trigger)', () => {
    let t = 0;
    let cost = 600; // each tick takes 600 ms of wall time: over 5× its 100 ms budget
    let calls = 0; // wall() is read twice per tick: start and end
    const { d, msgs } = setup(() => (t += calls++ % 2 ? cost : 0));
    d.play();
    for (let i = 0; i < 8; i++) d.tick(); // 4.8 s
    expect(msgs.filter((m) => m.type === 'slow')).toEqual([]);
    d.tick(); // 5.4 s
    d.tick();
    expect(msgs.filter((m) => m.type === 'slow')).toEqual([{ type: 'slow', speed: 1 }]);
    cost = 300; // under 5×: a single slow tick does not count
    const fresh = setup(() => (t += calls++ % 2 ? cost : 0));
    fresh.d.play();
    fresh.d.tick();
    expect(fresh.msgs.filter((m) => m.type === 'slow')).toEqual([]);
  });

  it('an engine error becomes a crash message with the event number; the run stops', () => {
    const { d, msgs } = setup();
    d.play();
    d.tick();
    (d as unknown as { run: { step: () => never } }).run.step = () => {
      throw new Error('boom\nstack');
    };
    d.tick();
    expect(msgs.at(-1)).toEqual({ type: 'crash', n: 6, reason: 'boom' });
    expect(d.state).toBe('crashed');
  });
});
