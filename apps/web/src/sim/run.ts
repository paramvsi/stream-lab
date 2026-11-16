import type { ChaosReport, DriverMessage, Event, RunOptions, RunState, RunStats } from '@sl/engine';
import RunWorker from '@sl/engine/worker?worker';
import { create } from 'zustand';
import {
  configOf,
  effectiveGenerator,
  labelOf,
  runBlocker,
  validate,
  type Graph,
  type PipelineNode,
  type Schema,
} from '@sl/graph';
import { useGraph, type PipelineData } from './store';
import { loadRows } from './uploads';
import { refCtx, useRefTables } from './refTables';

/**
 * Run store (ARCHITECTURE: separate from the graph store, not in undo history) and the Worker client.
 * A run uses the pipeline as it was when it started. Changing the pipeline during a run (an edit, undo,
 * redo) pauses it and marks it stale (SIMULATOR.md "Undo while running → pauses run first"); the next Run
 * starts over on the current pipeline (SIM-RUN-CHANGED).
 */
export interface RunStore {
  state: RunState;
  speed: number;
  stats: RunStats | null;
  /** EXPL-05: the run's length on the clock (the scrubber's range). */
  duration: number;
  crash: { n: number; reason: string } | null;
  /** SIM-SLOW: the speed that could not be kept up, until the toast is shown. */
  slow: number | null;
  /** The pipeline changed since this run started. */
  stale: boolean;
  /** SIM-RUN-CHANGED is shown only when a running or paused run was interrupted, not after it finished. */
  staleNotice: boolean;
  /** DATA-UPLOAD-UNUSED: Sources whose upload this run could not use, and why (shown once per run). */
  unused: { source: string; reason: string }[];
  /** SIM-16: the last chaos injection, until the pill says it. */
  chaos: ChaosReport | null;
  /** SIM-17: the node with most events in (computed once per stats message). */
  busiest: string | null;
}
const initial: RunStore = {
  state: 'ready',
  speed: 1,
  stats: null,
  duration: 0,
  crash: null,
  slow: null,
  stale: false,
  staleNotice: false,
  unused: [],
  chaos: null,
  busiest: null,
};
export const useRun = create<RunStore>(() => initial);

// SIM-16 speeds. MORNING D19: the board shows 1× / 4× / 16×, SIM-16 says 0.25×–10×; these stay in that range.
export const SPEEDS = [0.25, 1, 4, 10] as const;

const HEARTBEAT_MISS_MS = 3000; // catalog SIM-ENGINE-CRASH: heartbeat miss 3 s

let worker: Worker | null = null;
let loaded = false;
let loadedSig: unknown[] = [];
let lastSeen = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;

const crash = (reason: string) => {
  useRun.setState((s) => ({ state: 'crashed', crash: { n: s.stats?.processed ?? 0, reason } }));
  dispose();
};

function busiestOf(stats: RunStats): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [id, n] of Object.entries(stats.nodes))
    if (n.in > most) {
      most = n.in;
      best = id;
    }
  return best;
}

function connect(): Worker {
  if (worker) return worker;
  const w = new RunWorker();
  lastSeen = Date.now();
  w.onmessage = (e: MessageEvent<DriverMessage>) => {
    lastSeen = Date.now();
    const m = e.data;
    if (m.type === 'beat') return;
    if (m.type === 'chaos') return void useRun.setState({ chaos: m.report });
    if (m.type === 'stats')
      useRun.setState({
        state: m.state,
        speed: m.speed,
        stats: m.stats,
        busiest: busiestOf(m.stats),
        ...(m.duration !== undefined ? { duration: m.duration } : {}),
      });
    else if (m.type === 'slow') useRun.setState({ slow: m.speed });
    else useRun.setState({ state: 'crashed', crash: { n: m.n, reason: m.reason } });
  };
  // Out of memory or an uncaught error kills the worker: SIM-ENGINE-CRASH, the pipeline is untouched.
  w.onerror = (e) => {
    e.preventDefault();
    crash('the engine ran out of memory or hit an internal error');
  };
  w.onmessageerror = () => crash('a message from the engine could not be read');
  // A worker stuck in a loop sends nothing: 3 s without its 1 s heartbeat while running is a crash. If this
  // check itself ran late (the laptop slept, the tab was frozen), the silence is ours, not the engine's: start over.
  let lastCheck = Date.now();
  watchdog = setInterval(() => {
    const now = Date.now();
    const late = now - lastCheck > 2000;
    lastCheck = now;
    if (late || useRun.getState().state !== 'running') lastSeen = now;
    else if (now - lastSeen > HEARTBEAT_MISS_MS) crash('the engine stopped responding');
  }, 1000);
  worker = w;
  return w;
}

/** What a run depends on: node types, settings, disabled flags and edges (not positions). */
const signature = (): unknown[] => {
  const { nodes, edges, data, seed } = useGraph.getState();
  // Labels too: a Union's tag field carries the input node's label.
  // The imported reference tables too (DATA-03): the run joins the ones it was loaded with.
  return [
    edges,
    data,
    seed,
    useRefTables.getState().user,
    ...nodes.flatMap((n) => [n.id, n.type, n.config, n.disabled ?? false, n.label]),
  ];
};
const sameSig = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * DATA-02: rows for Sources with an upload. A file gone from this browser (copied or imported pipeline, cleared site
 * data) or rows missing a field the Source now needs fall back to the generator, and say why (DATA-UPLOAD-UNUSED).
 */
export async function uploadedRows(
  pipelineId: string,
  nodes: PipelineNode[],
  data: PipelineData,
  /** The preview reads only the rows it shows. */
  limit = Infinity,
): Promise<{ sourceData: Record<string, Event[]>; unused: { source: string; reason: string }[] }> {
  const sourceData: Record<string, Event[]> = {};
  const unused: { source: string; reason: string }[] = [];
  for (const [id, u] of Object.entries(data.uploads ?? {})) {
    const n = nodes.find((x) => x.id === id && x.type === 'Source');
    if (!n) continue;
    const rows = await loadRows(pipelineId, id, limit);
    if (!rows) {
      unused.push({ source: labelOf(n), reason: `${u.file} is not in this browser` });
      continue;
    }
    const c = configOf(n) as { schema: Schema; eventTime: string };
    const need = c.schema.filter((f) => f.required || f.name === c.eventTime).map((f) => f.name);
    // Every row, not only the first: a field made required after the upload may be empty further down.
    const missing = need.find((f) => rows.some((r) => r[f] === undefined || r[f] === null));
    if (missing) {
      unused.push({
        source: labelOf(n),
        reason: `${u.file} has no "${missing}", which the Source now needs`,
      });
      continue;
    }
    sourceData[id] = rows;
  }
  return { sourceData, unused };
}

/** What the live run was loaded with (EXPL-02/03 replay it exactly), and whether Chaos changed it since. */
let loadedRun: { graph: Graph; opts: RunOptions } | null = null;
let chaosUsed = false;

/** Explain / Trace may replay only the run that is shown; otherwise the reason (EXPLAIN-UNAVAILABLE). */
export const EXPLAIN_MAX_EVENTS = 200_000;
export function replaySource(): { graph: Graph; opts: RunOptions } | { reason: string } {
  const r = useRun.getState();
  if (!loadedRun || r.state === 'ready' || !r.stats) return { reason: 'run the pipeline first' };
  if (r.stale) return { reason: 'the pipeline changed since this run; run it again' };
  if (chaosUsed)
    return { reason: "this run has Chaos events, which a replay can't repeat; run it again without Chaos" };
  if (r.stats.total > EXPLAIN_MAX_EVENTS)
    return {
      reason: `this run has ${r.stats.total.toLocaleString('en-US')} events; explain works up to ${EXPLAIN_MAX_EVENTS.toLocaleString('en-US')}`,
    };
  return loadedRun;
}

async function load() {
  const { nodes, edges, seed, data, pipelineId } = useGraph.getState();
  const sig = signature();
  const refTables = useRefTables.getState().user; // read with the signature, not after the await
  const { sourceData, unused } = await uploadedRows(pipelineId, nodes, data);
  useRun.setState({ unused });
  const graph = { nodes, edges };
  // The same settings the Data drawer shows (invalid stored values fall back field by field).
  const opts: RunOptions = {
    seed,
    sourceData,
    generator: effectiveGenerator(data.generator, seed),
    refTables,
  };
  loadedRun = { graph, opts };
  chaosUsed = false;
  connect().postMessage({ type: 'load', graph, opts });
  connect().postMessage({ type: 'speed', speed: useRun.getState().speed });
  loaded = true;
  loadedSig = sig;
  useRun.setState({ stale: false, staleNotice: false });
}

/** SIM-RUN-BLOCKED: a pipeline with errors does not run, from any button (pill or toast). */
const blocked = () => {
  const { nodes, edges } = useGraph.getState();
  return runBlocker(validate({ nodes, edges }, refCtx())) !== null; // the graph now, not the debounced issues store
};

// A change to the pipeline during a run: pause, and start over on the next Run.
function markStale() {
  if (!loaded || useRun.getState().stale || sameSig(signature(), loadedSig)) return;
  const state = useRun.getState().state;
  if (state === 'running') worker?.postMessage({ type: 'pause' });
  useRun.setState({ stale: true, staleNotice: state === 'running' || state === 'paused' });
}
useGraph.subscribe(markStale);
useRefTables.subscribe(markStale);

export const runner = {
  /** False when the pipeline is blocked (SIM-RUN-BLOCKED): nothing runs, the caller says why. */
  async play(): Promise<boolean> {
    if (blocked()) return false;
    const { state, stale } = useRun.getState();
    if (!loaded || stale || state === 'finished') await load();
    connect().postMessage({ type: 'play' });
    return true;
  },
  pause: () => worker?.postMessage({ type: 'pause' }),
  chaos: () => {
    chaosUsed = true;
    worker?.postMessage({ type: 'chaos' });
  },
  async step() {
    if (blocked()) return;
    if (!loaded || useRun.getState().stale) await load();
    connect().postMessage({ type: 'step' });
  },
  /** Back to Ready: the next Run or Step loads the pipeline as it is then. */
  /** EXPL-05 time scrubber: the run as it was at clock `at` (replayed to there, then paused). */
  seek(at: number) {
    if (!loaded || useRun.getState().stale) return;
    chaosUsed = false; // the replay drops what Chaos injected
    worker?.postMessage({ type: 'seek', at });
  },
  reset() {
    loaded = false;
    useRun.setState({ state: 'ready', stats: null, stale: false, busiest: null });
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
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  loaded = false;
  useRun.setState({ ...initial, speed: useRun.getState().speed, crash: useRun.getState().crash });
}

const fmt = (x: number) => x.toLocaleString('en-US');
export { fmt };

const live = (s: RunStore) => s.state !== 'ready' && s.stats !== null;

/**
 * SIM-17 count label for a node while a run exists, as on board W09i: "out" is the main output (side outputs show
 * on their edges); a source shows in = out; a sink or dead letter shows what it wrote. A string, so nodes
 * re-render only when it changes.
 */
export const useNodeCounts = (id: string, kind: 'source' | 'sink' | 'node', mainPorts: string) =>
  useRun((s) => {
    const n = live(s) ? s.stats!.nodes[id] : undefined;
    if (!n) return null;
    // Every main-kind output (a Route's branches and default), not side outputs.
    const main = mainPorts.split(',').reduce((a, p) => a + (n.out[p] ?? 0), 0);
    const [i, o] = kind === 'source' ? [main, main] : kind === 'sink' ? [n.in, n.in] : [n.in, main];
    return `in ${fmt(i)} · out ${fmt(o)}`;
  });

/** SIM-18: events whose expression failed in this node during the run (0 when idle). */
export const useNodeFailed = (id: string) => useRun((s) => (live(s) ? (s.stats!.nodes[id]?.failed ?? 0) : 0));

/** The first failure reason for a node (catalog SIM-RUNTIME-EXPR {reason}). */
export const useNodeFailReason = (id: string) =>
  useRun((s) => s.stats?.deadLetter.find((d) => d.node === id)?.reason ?? '');

/** SIM-17: true for the busiest node while running. */
export const useIsBusiest = (id: string) => useRun((s) => s.state === 'running' && s.busiest === id);

/** SIM-17: events that crossed one edge, or null when idle. */
export const useEdgeCount = (id: string) => useRun((s) => (live(s) ? (s.stats!.edges[id] ?? 0) : null));

/** WM01/WM02: a Window's results and a node's late events so far (0 when idle) — the motion replays on change. */
export const useNodeFires = (id: string) =>
  useRun((s) => (live(s) ? (s.stats!.nodes[id]?.out['main'] ?? 0) : 0));
export const useNodeLate = (id: string) => useRun((s) => (live(s) ? (s.stats!.nodes[id]?.late ?? 0) : 0));
