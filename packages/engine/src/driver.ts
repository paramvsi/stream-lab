import { createRun, type Run, type RunOptions, type RunStats } from './engine';
import type { Graph } from '@sl/graph';

export type RunState = 'ready' | 'running' | 'paused' | 'finished' | 'crashed';

export type DriverMessage =
  | { type: 'stats'; state: RunState; speed: number; stats: RunStats }
  | { type: 'crash'; n: number; reason: string }
  | { type: 'slow'; speed: number };

/** Wall-clock budget per tick before the run reports SIM-SLOW. */
export const TICK_MS = 100;

/**
 * SIM-16 / ENG-01: paces a run on the simulation clock. Every tick (100 ms of wall time) it advances the
 * simulation clock by 100 ms × speed and posts one batched stats message (never one per event).
 * Pure: the Worker calls tick() from a timer; tests call it directly.
 */
export class Driver {
  state: RunState = 'ready';
  speed = 1;
  private run: Run;
  private clock = 0;
  private slowSent = false;

  constructor(
    private graph: Graph,
    private opts: RunOptions,
    private post: (m: DriverMessage) => void,
    private wall: () => number = () => performance.now(),
  ) {
    this.run = createRun(graph, opts);
  }

  private guard(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.state = 'crashed';
      this.post({
        type: 'crash',
        n: this.run.stats().processed,
        reason: (err as Error)?.message?.split('\n')[0] || 'unknown error',
      });
    }
  }

  private send() {
    this.post({ type: 'stats', state: this.state, speed: this.speed, stats: this.run.stats() });
  }

  play() {
    if (this.state === 'ready' || this.state === 'paused') this.state = 'running';
    this.send();
  }

  pause() {
    if (this.state === 'running') this.state = 'paused';
    this.send();
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.slowSent = false;
    this.send();
  }

  /** One event (paused or ready). */
  step() {
    if (this.state !== 'paused' && this.state !== 'ready') return;
    this.guard(() => {
      this.state = 'paused';
      if (!this.run.step()) this.state = 'finished';
      this.clock = this.run.stats().now;
    });
    this.send();
  }

  reset() {
    this.run = createRun(this.graph, this.opts);
    this.clock = 0;
    this.state = 'ready';
    this.send();
  }

  /** Advance one tick of `TICK_MS` wall time. */
  tick() {
    if (this.state !== 'running') return;
    const t0 = this.wall();
    this.guard(() => {
      this.clock += TICK_MS * this.speed;
      for (let at = this.run.next(); at !== undefined && at <= this.clock; at = this.run.next())
        this.run.step();
      if (this.run.next() === undefined) {
        this.run.step(); // flush: final watermark
        this.state = 'finished';
      }
    });
    if ((this.state as RunState) === 'crashed') return;
    const took = this.wall() - t0;
    // SIM-SLOW: the tick could not keep up with the requested speed.
    if (took > TICK_MS && !this.slowSent) {
      this.slowSent = true;
      this.post({ type: 'slow', speed: this.speed });
    }
    this.send();
  }
}
