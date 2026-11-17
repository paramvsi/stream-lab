import { describe, expect, it } from 'vitest';
import { diffJob, gaps, memoryHistory } from './history';

const job = (state: string, ps: Record<string, number>, restartingAt = 0) => ({
  state,
  timestamps: { RUNNING: 1, RESTARTING: restartingAt },
  vertices: Object.entries(ps).map(([id, parallelism]) => ({ id, name: `op ${id}`, parallelism })),
});

describe('JOB-06 · local history (D10)', () => {
  it('diffJob: a new RESTARTING entry time is a Restart (also when no read saw RESTARTING); a parallelism change is a Rescaled', () => {
    const a = job('RUNNING', { v1: 4, v2: 4 });
    expect(diffJob(a, job('RESTARTING', { v1: 4, v2: 4 }, 10), 10)).toEqual([
      { at: 10, kind: 'restart', detail: 'Job restarted' },
    ]);
    // Still restarting (same entry time): once.
    expect(diffJob(job('RESTARTING', { v1: 4 }, 10), job('RESTARTING', { v1: 4 }, 10), 11)).toEqual([]);
    // audit h #1: restarted and back to RUNNING between two reads: the entry time moved.
    expect(diffJob(job('RUNNING', { v1: 4 }, 10), job('RUNNING', { v1: 4 }, 20), 21)).toEqual([
      { at: 20, kind: 'restart', detail: 'Job restarted' },
    ]);
    expect(diffJob(a, job('RUNNING', { v1: 4, v2: 8 }), 12)).toEqual([
      { at: 12, kind: 'rescale', detail: 'op v2: parallelism 4 → 8' },
    ]);
    expect(diffJob(null, a, 13)).toEqual([]); // the first read is a baseline, not an event
  });

  it('audit h #2: a restart that changed parallelism is one Rescaled, not a Restart as well', () => {
    expect(diffJob(job('RUNNING', { v1: 4 }), job('RESTARTING', { v1: 8 }, 30), 31)).toEqual([
      { at: 31, kind: 'rescale', detail: 'op v1: parallelism 4 → 8' },
    ]);
  });

  it('memoryHistory keeps events per connection and job (job ids repeat across clusters), newest first', async () => {
    const h = memoryHistory();
    await h.append('prod', 'j1', [{ at: 1, kind: 'restart', detail: 'x' }]);
    await h.append('prod', 'j1', [{ at: 5, kind: 'rescale', detail: 'y' }]);
    await h.append('staging', 'j1', [{ at: 3, kind: 'restart', detail: 'z' }]);
    expect((await h.events('prod', 'j1')).map((e) => e.at)).toEqual([5, 1]);
    expect((await h.events('staging', 'j1')).map((e) => e.at)).toEqual([3]);
    await h.session(100, 200);
    await h.session(100, 250); // extends
    await h.session(500, 600);
    expect(await h.sessions()).toEqual([
      { from: 100, to: 250 },
      { from: 500, to: 600 },
    ]);
  });

  it('gaps: the times between sessions (Stream Lab closed), newest first; overlapping sessions leave none', () => {
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
    expect(
      gaps([
        { from: 100, to: 500 },
        { from: 200, to: 300 },
        { from: 400, to: 600 },
      ]),
    ).toEqual([]);
    expect(gaps([])).toEqual([]);
  });
});
