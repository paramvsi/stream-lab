import { createRun, type Run, type RunOptions, type RunStats } from './engine';
import type { Graph } from '@sl/graph';

export type RunState = 'ready' | 'running' | 'paused' | 'finished' | 'crashed';

export type DriverMessage =
  | { type: 'stats'; state: RunState; speed: number; stats: RunStats }
  | { type: 'crash'; n: number; reason: string }
  | { type: 'slow'; speed: number }
  /** Sent every second by the worker (SIM-ENGINE-CRASH heartbeat). */
  | { type: 'beat' };

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
  // Null when building the run failed (a crash was posted).
  private run: Run | null = null;
  private clock = 0;
  private slowSent = false;
  private slowFor = 0;

  constructor(
    private graph: Graph,
    private opts: RunOptions,
    private post: (m: DriverMessage) => void,
    private wall: () => number = () => performance.now(),
  ) {
    this.build();
  }

  /** Build the run inside the guard: a throw here (bad graph, out of memory) is a crash too (SIM-19). */
  private build() {
    this.run = null;
    this.guard(() => {
      this.run = createRun(this.graph, this.opts);
    });
  }

  private guard(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.state = 'crashed';
      this.post({
        type: 'crash',
        n: this.run?.stats().processed ?? 0,
        reason: (err as Error)?.message?.split('\n')[0] || 'unknown error',
      });
    }
  }

  private send() {
    if (this.run) this.post({ type: 'stats', state: this.state, speed: this.speed, stats: this.run.stats() });
  }

  play() {
    if (!this.run) return;
    if (this.state === 'ready' || this.state === 'paused') this.state = 'running';
    this.send();
  }

  pause() {
    if (this.state === 'running') this.state = 'paused';
    this.send();
  }

  setSpeed(speed: number) {
    if (!(speed > 0) || !Number.isFinite(speed)) return; // 0 would freeze the run
    this.speed = speed;
    this.slowSent = false;
    this.send();
  }

  /** One event (paused or ready). */
  step() {
    if (this.state !== 'paused' && this.state !== 'ready') return;
    this.guard(() => {
      const run = this.run!;
      this.state = 'paused';
      run.step();
      // The last event also ends the input: flush the final watermark and finish.
      if (run.next() === undefined) {
        run.step();
        this.state = 'finished';
      }
      this.clock = run.stats().now;
    });
    this.send();
  }

  reset() {
    this.clock = 0;
    this.state = 'ready';
    this.build();
    this.send();
  }

  /** Advance one tick of `TICK_MS` wall time. */
  tick() {
    if (this.state !== 'running') return;
    const t0 = this.wall();
    this.guard(() => {
      this.clock += TICK_MS * this.speed;
      const run = this.run!;
      for (let at = run.next(); at !== undefined && at <= this.clock; at = run.next()) run.step();
      if (run.next() === undefined) {
        run.step(); // flush: final watermark
        this.state = 'finished';
      }
    });
    if ((this.state as RunState) === 'crashed') return;
    const took = this.wall() - t0;
    // SIM-SLOW (catalog): events/s below 20 % of target for 5 s — ticks taking over 5× their budget, back to
    // back, for 5 s of wall time. One slow tick (a GC pause, warm-up) is not enough.
    this.slowFor = took > TICK_MS * 5 ? this.slowFor + took : 0;
    if (this.slowFor >= 5000 && !this.slowSent) {
      this.slowSent = true;
      this.post({ type: 'slow', speed: this.speed });
    }
    this.send();
  }
}
