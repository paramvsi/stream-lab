import type { DriverMessage, RunState, RunStats } from '@sl/engine';
import RunWorker from '@sl/engine/worker?worker';
import { create } from 'zustand';
import { useGraph } from './store';

/**
 * Run store (ARCHITECTURE: separate from the graph store, not in undo history) and the Worker client.
 * The run uses a snapshot of the pipeline taken when it starts; Reset takes a new one.
 */
export interface RunStore {
  state: RunState;
  speed: number;
  stats: RunStats | null;
  crash: { n: number; reason: string } | null;
  /** SIM-SLOW: the speed that could not be kept up, until the toast is shown. */
  slow: number | null;
}
const initial: RunStore = { state: 'ready', speed: 1, stats: null, crash: null, slow: null };
export const useRun = create<RunStore>(() => initial);

// SIM-16 speeds. MORNING D19: the board shows 1× / 4× / 16×, SIM-16 says 0.25×–10×; these stay in that range.
export const SPEEDS = [0.25, 1, 4, 10] as const;

let worker: Worker | null = null;
let loaded = false;

function connect(): Worker {
  if (worker) return worker;
  const w = new RunWorker();
  w.onmessage = (e: MessageEvent<DriverMessage>) => {
    const m = e.data;
    if (m.type === 'stats') useRun.setState({ state: m.state, speed: m.speed, stats: m.stats });
    else if (m.type === 'slow') useRun.setState({ slow: m.speed });
    else useRun.setState({ state: 'crashed', crash: { n: m.n, reason: m.reason } });
  };
  // Out of memory or an uncaught error kills the worker: SIM-ENGINE-CRASH, the pipeline is untouched.
  w.onerror = (e) => {
    e.preventDefault();
    useRun.setState((s) => ({
      state: 'crashed',
      crash: { n: s.stats?.processed ?? 0, reason: 'the engine ran out of memory or hit an internal error' },
    }));
    dispose();
  };
  worker = w;
  return w;
}

function load() {
  const { nodes, edges } = useGraph.getState();
  connect().postMessage({ type: 'load', graph: { nodes, edges }, opts: {} });
  connect().postMessage({ type: 'speed', speed: useRun.getState().speed });
  loaded = true;
}

export const runner = {
  play() {
    if (!loaded || useRun.getState().state === 'finished') load();
    connect().postMessage({ type: 'play' });
  },
  pause: () => worker?.postMessage({ type: 'pause' }),
  step() {
    if (!loaded) load();
    connect().postMessage({ type: 'step' });
  },
  reset() {
    load();
    useRun.setState({ stats: null });
  },
  speed(speed: number) {
    useRun.setState({ speed });
    worker?.postMessage({ type: 'speed', speed });
  },
  dismissCrash: () => {
    dispose();
    useRun.setState({ crash: null, state: 'ready', stats: null });
  },
};

/** Leaving the workspace (or "Reload simulator") ends the worker and clears the run. */
export function dispose() {
  worker?.terminate();
  worker = null;
  loaded = false;
  useRun.setState({ ...initial, crash: useRun.getState().crash });
}
