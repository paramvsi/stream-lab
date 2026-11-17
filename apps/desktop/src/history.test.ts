import { describe, expect, it } from 'vitest';
import { diffJob, gaps, memoryHistory } from './history';

const job = (state: string, ps: Record<string, number>) => ({
  state,
  vertices: Object.entries(ps).map(([id, parallelism]) => ({ id, name: `op ${id}`, parallelism })),
});

describe('JOB-06 · local history (D10)', () => {
  it('diffJob: entering RESTARTING is a Restart; a parallelism change is a Rescaled with from → to', () => {
    const a = job('RUNNING', { v1: 4, v2: 4 });
    expect(diffJob(a, job('RESTARTING', { v1: 4, v2: 4 }), 10)).toEqual([
      { at: 10, kind: 'restart', detail: 'Job restarted' },
    ]);
    expect(diffJob(job('RESTARTING', { v1: 4 }), job('RESTARTING', { v1: 4 }), 11)).toEqual([]); // still restarting: once
    expect(diffJob(a, job('RUNNING', { v1: 4, v2: 8 }), 12)).toEqual([
      { at: 12, kind: 'rescale', detail: 'op v2: parallelism 4 → 8' },
    ]);
    expect(diffJob(null, a, 13)).toEqual([]); // the first read is a baseline, not an event
  });

  it('memoryHistory keeps events per job, newest first, and the sessions it was open for', async () => {
    const h = memoryHistory();
    await h.append('j1', [{ at: 1, kind: 'restart', detail: 'x' }]);
    await h.append('j1', [{ at: 5, kind: 'rescale', detail: 'y' }]);
    await h.append('j2', [{ at: 3, kind: 'restart', detail: 'z' }]);
    expect((await h.events('j1')).map((e) => e.at)).toEqual([5, 1]);
    await h.session(100, 200);
    await h.session(500, 600);
    expect(await h.sessions()).toEqual([
      { from: 100, to: 200 },
      { from: 500, to: 600 },
    ]);
  });

  it('gaps: the times between sessions (Stream Lab closed), newest first', () => {
    expect(
      gaps([
        { from: 100, to: 200 },
        { from: 500, to: 600 },
        { from: 700, to: 800 },
      ]),
    ).toEqual([
      { from: 600, to: 700 },
      { from: 200, to: 500 },
    ]);
    expect(gaps([])).toEqual([]);
  });
});
