/// <reference lib="webworker" />
import type { Graph } from '@sl/graph';
import { Driver, TICK_MS, type DriverMessage } from './driver';
import type { RunOptions } from './engine';

/** ENG-01: the engine runs here, off the page's thread. Messages: see WorkerCommand. */
export type WorkerCommand =
  | { type: 'load'; graph: Graph; opts: RunOptions }
  | { type: 'play' | 'pause' | 'step' | 'reset' | 'chaos' }
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

// SIM-ENGINE-CRASH: the page treats 3 s without this as a crash (an engine stuck in a loop sends nothing).
setInterval(() => self.postMessage({ type: 'beat' } satisfies DriverMessage), 1000);

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
    // Only a run that is now running gets a timer (a finished or crashed one would leak it).
    if (driver.state === 'running') timer ??= setInterval(() => driver?.tick(), TICK_MS);
  } else if (c.type === 'pause') driver.pause();
  else if (c.type === 'step') driver.step();
  else if (c.type === 'reset') driver.reset();
  else if (c.type === 'chaos') driver.chaos();
  else if (c.type === 'speed') driver.setSpeed(c.speed);
};
