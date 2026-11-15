/// <reference lib="webworker" />
import type { Graph } from '@sl/graph';
import { Driver, TICK_MS, type DriverMessage } from './driver';
import type { RunOptions } from './engine';

/** ENG-01: the engine runs here, off the page's thread. Messages: see WorkerCommand. */
export type WorkerCommand =
  | { type: 'load'; graph: Graph; opts: RunOptions }
  | { type: 'play' | 'pause' | 'step' | 'reset' }
  | { type: 'speed'; speed: number };

let driver: Driver | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const post = (m: DriverMessage) => {
  self.postMessage(m);
  if (m.type === 'crash' || (m.type === 'stats' && m.state !== 'running')) stop();
};
const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const c = e.data;
  if (c.type === 'load') {
    stop();
    driver = new Driver(c.graph, c.opts, post);
    return;
  }
  if (!driver) return;
  if (c.type === 'play') {
    driver.play();
    timer ??= setInterval(() => driver?.tick(), TICK_MS);
  } else if (c.type === 'pause') driver.pause();
  else if (c.type === 'step') driver.step();
  else if (c.type === 'reset') driver.reset();
  else if (c.type === 'speed') driver.setSpeed(c.speed);
};
