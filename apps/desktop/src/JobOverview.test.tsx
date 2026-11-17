import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { duration, JobOverview, size } from './JobOverview';

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const conn: Connection = {
  id: 'c-p',
  name: 'payments-prod',
  url: 'https://payments-prod.example.com:8081',
  kind: 'standalone',
  env: 'prod',
  readOnly: false,
  basePath: '',
  auth: { type: 'none' },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: 10000,
  pollMs: 5000,
};
const v = (id: string, name: string, parallelism: number, status = 'RUNNING') => ({
  id,
  name,
  parallelism,
  'start-time': 1,
  'end-time': -1,
  duration: 1,
  status,
});
const detail = {
  jid: 'a5e0edd8e66b53f1b89c2041',
  name: 'refund-matcher',
  state: 'RUNNING',
  'start-time': 1,
  'end-time': -1,
  duration: 6 * 86_400_000,
  now: 1 + 6 * 86_400_000,
  vertices: [v('v1', 'Source: payments', 4), v('v2', 'Window aggregate', 4), v('v3', 'Sink: alerts', 2)],
};
const ckpt = {
  counts: { completed: 9, failed: 0, in_progress: 0, restored: 0, total: 9 },
  latest: {
    completed: {
      id: 9,
      status: 'COMPLETED',
      is_savepoint: false,
      trigger_timestamp: detail.now - 120_000 - 3_400,
      latest_ack_timestamp: detail.now - 120_000,
      end_to_end_duration: 3_400,
      checkpointed_size: 220 * 1024 * 1024,
      num_subtasks: 4,
      num_acknowledged_subtasks: 4,
    },
  },
  history: [],
};
const npe = (ts: number) => ({
  exceptionName: 'java.lang.RuntimeException',
  stacktrace: `java.lang.RuntimeException: wrapped\n\tat a\nCaused by: java.lang.NullPointerException: merchant_id is null\n\tat b`,
  timestamp: ts,
  taskName: 'Window aggregate (2/4)',
});
/** Four failures in the last 12 minutes, newest first (as Flink sends them). */
const excs = {
  exceptionHistory: {
    entries: [0, 4, 8, 12].map((m) => npe(detail.now - m * 60_000)),
    truncated: false,
  },
};
/** The job answers `body`; its checkpoints answer `cp` (stats; or an Error, or a config body for /config). */
const answer =
  (status: number, body: unknown, cp: unknown = ckpt, config: unknown = { interval: 10_000 }): FlinkHttp =>
  async (req) =>
    req.path.endsWith('/exceptions')
      ? { status: 200, headers: {}, url: '', body: JSON.stringify(excs) }
      : req.path.endsWith('/checkpoints/config')
        ? { status: 200, headers: {}, url: '', body: JSON.stringify(config) }
        : req.path.endsWith('/checkpoints')
          ? cp instanceof Error
            ? { status: 404, headers: {}, url: '', body: JSON.stringify({ errors: [cp.message] }) }
            : { status: 200, headers: {}, url: '', body: JSON.stringify(cp) }
          : { status, headers: {}, url: '', body: JSON.stringify(body) };
const show = (http: FlinkHttp, more: { onJobs?: () => void } = {}, c: Connection = conn) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <JobOverview c={c} jid={detail.jid} transport={() => http} {...more} />
      </ToastProvider>
    </TooltipProvider>,
  );

describe('JOB-02 · Job overview (board D08)', () => {
  it('loading, then the header: name, status in words, id, uptime and parallelism', async () => {
    show(answer(200, detail));
    expect(screen.getByRole('status', { name: 'Loading job' })).toBeInTheDocument();
    const h = await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    expect(within(h.parentElement!).getByText('Running')).toBeInTheDocument(); // the job's own badge
    expect(screen.getByText(detail.jid)).toBeInTheDocument();
    expect(screen.getByText(/started 6 days ago · parallelism 4/)).toBeInTheDocument(); // D08 wording
    expect(screen.getByText(/on payments-prod/)).toBeInTheDocument();
  });

  it('D08 Last checkpoint: duration · size, and how long ago', async () => {
    show(answer(200, detail));
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('3.4 s · 220 MB'));
    expect(k).toHaveTextContent('2 min ago'); // the board's short form
    expect(within(k).getByText('2 min ago').className).toMatch(/text-success-600/); // healthy: green (D08)
  });

  it('none completed yet (checkpointing on): says so', async () => {
    show(answer(200, detail, { ...ckpt, counts: { ...ckpt.counts, completed: 0, total: 0 }, latest: {} }));
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('None yet'));
  });

  it('checkpointing off (no settings: 404) shows JOB-CKPT-NONE, not an error page', async () => {
    show(answer(200, detail, new Error('Checkpointing has not been enabled.')));
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('Off'));
    expect(k).toHaveTextContent(
      'Checkpointing is off for this job, so it cannot recover state after a failure.',
    );
  });

  it('audit #2: checkpoints failing (500) degrade the KPI alone; the job still shows', async () => {
    show(async (req) =>
      req.path.endsWith('/checkpoints')
        ? { status: 500, headers: {}, url: '', body: '' }
        : answer(200, detail)(req),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'refund-matcher' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Operators' })).toBeInTheDocument();
    const k = screen.getByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('—'));
    expect(screen.queryByRole('alert')).toBeNull(); // no page banner for one widget
  });

  it('audit #1: checkpoints are polled every 5 s (FLINK_API), the job every 2 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const calls: string[] = [];
      show(async (req) => (calls.push(req.path), answer(200, detail)(req)));
      await screen.findByRole('table', { name: 'Operators' });
      calls.length = 0;
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      const n = (end: string) => calls.filter((p) => p.endsWith(end)).length;
      expect(n(detail.jid)).toBeGreaterThanOrEqual(4); // ~5 in 10 s
      expect(n('/checkpoints')).toBeLessThanOrEqual(2); // ~2 in 10 s, not ~5
      expect(n('/checkpoints')).toBeGreaterThanOrEqual(1); // and still polled
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 2 #2: failures since the last completed one are "Failed · N failures in a row", red (D08c)', async () => {
    const f = (id: number) => ({ ...ckpt.latest.completed, id, status: 'FAILED' });
    show(
      answer(200, detail, {
        ...ckpt,
        counts: { ...ckpt.counts, failed: 3 },
        latest: { completed: ckpt.latest.completed, failed: { id: 12, failure_message: 'timeout' } },
        history: [f(12), f(11), f(10), ckpt.latest.completed],
      }),
    );
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('Failed'));
    expect(within(k).getByText('3 failures in a row').className).toMatch(/text-danger-600/);
  });

  it('audit 2 #1: one outage, one "Back in contact" (the checkpoint poll stays quiet)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let down = false;
      show(async (req) => {
        if (down)
          throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
        return answer(200, detail)(req);
      });
      await screen.findByRole('table', { name: 'Operators' });
      down = true;
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      down = false;
      // Every toast seen over the next 40 s (success toasts close after 4 s, so two in a row never overlap).
      // Toasts, not text: Radix also copies a toast's words into a hidden announcer for a moment.
      const seen = new Set<Element>();
      for (let t = 0; t < 40; t++) {
        await act(async () => vi.advanceTimersByTimeAsync(1_000));
        document.querySelectorAll('.sl-toast').forEach((e) => {
          if (/Back in contact with payments-prod/.test(e.textContent ?? '')) seen.add(e);
        });
      }
      expect(seen.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 2 #3: checkpoints failing after a good read mark the KPI stale, not still green', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let bad = false;
      show(async (req) =>
        bad && req.path.endsWith('/checkpoints')
          ? { status: 500, headers: {}, url: '', body: '' }
          : answer(200, detail)(req),
      );
      const k = await screen.findByRole('group', { name: 'Last checkpoint' });
      await waitFor(() => expect(k).toHaveTextContent('3.4 s'));
      bad = true;
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
      await waitFor(() => expect(k).toHaveTextContent(/Not answering/));
      expect(within(k).queryByText('2 min ago')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 3 #1: stale while failing still says Failed (red), with the stale note', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let bad = false;
      const f = (id: number) => ({ ...ckpt.latest.completed, id, status: 'FAILED' });
      const failing = { ...ckpt, history: [f(12), f(11), ckpt.latest.completed] };
      show(async (req) =>
        req.path.endsWith('/checkpoints')
          ? bad
            ? { status: 500, headers: {}, url: '', body: '' }
            : { status: 200, headers: {}, url: '', body: JSON.stringify(failing) }
          : answer(200, detail)(req),
      );
      const k = await screen.findByRole('group', { name: 'Last checkpoint' });
      await waitFor(() => expect(k).toHaveTextContent('Failed'));
      bad = true;
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
      await waitFor(() => expect(k).toHaveTextContent(/Not answering/));
      expect(k).toHaveTextContent('Failed');
      expect(k).not.toHaveTextContent('3.4 s');
      expect(within(k).getByText(/Not answering/).className).toMatch(/text-danger-600/); // still red
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 3 #2: savepoints do not count as checkpoint failures, nor end a run of them', async () => {
    const sp = (id: number, status: string) => ({ ...ckpt.latest.completed, id, status, is_savepoint: true });
    show(answer(200, detail, { ...ckpt, history: [sp(13, 'FAILED'), ckpt.latest.completed] }));
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('3.4 s'));
    expect(k).not.toHaveTextContent('Failed');
  });

  it('audit 4 #3: a completed savepoint inside a run of failed checkpoints does not end it', async () => {
    const f = (id: number) => ({ ...ckpt.latest.completed, id, status: 'FAILED' });
    const sp = { ...ckpt.latest.completed, id: 12, status: 'COMPLETED', is_savepoint: true };
    show(answer(200, detail, { ...ckpt, history: [f(14), f(13), sp, f(11), ckpt.latest.completed] }));
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('3 failures in a row'));
  });

  it('audit 4 #1: a new job whose first checkpoints all failed (nothing dropped) is exact: "3", not "3+"', async () => {
    const f = (id: number) => ({ ...ckpt.latest.completed, id, status: 'FAILED' });
    show(
      answer(200, detail, {
        counts: { completed: 0, failed: 3, in_progress: 0, restored: 0, total: 3 },
        latest: {},
        history: [f(3), f(2), f(1)],
      }),
    );
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('3 failures in a row'));
    expect(k).not.toHaveTextContent('3+');
  });

  it('audit 4 #2: a full history with a savepoint in it, all checkpoints failed, is "9+"', async () => {
    const f = (id: number) => ({ ...ckpt.latest.completed, id, status: 'FAILED' });
    const sp = { ...ckpt.latest.completed, id: 30, status: 'COMPLETED', is_savepoint: true };
    show(
      answer(200, detail, {
        ...ckpt,
        counts: { ...ckpt.counts, failed: 25, total: 40 },
        history: [sp, ...Array.from({ length: 9 }, (_, i) => f(29 - i))],
      }),
    );
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('9+ failures in a row'));
  });

  it('audit 3 #3: a run longer than the history says "10+", not "10"', async () => {
    const f = (id: number) => ({ ...ckpt.latest.completed, id, status: 'FAILED' });
    show(
      answer(200, detail, {
        ...ckpt,
        counts: { ...ckpt.counts, failed: 60, total: 70 },
        history: Array.from({ length: 10 }, (_, i) => f(60 - i)),
      }),
    );
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('10+ failures in a row'));
  });

  it('audit #3/#4: duration and size carry at unit edges; a missing size is "—"', () => {
    expect(duration(59_950)).toBe('1 min 0 s');
    expect(duration(119_600)).toBe('2 min 0 s');
    expect(duration(999.6)).toBe('1.0 s');
    expect(duration(3_400)).toBe('3.4 s');
    expect(size(1024 ** 2 - 1)).toBe('1 MB');
    expect(size(1024 ** 3 - 1)).toBe('1.0 GB');
    expect(size(500)).toBe('500 B');
    expect(size(220 * 1024 ** 2)).toBe('220 MB');
    expect(size(undefined)).toBe('—');
  });

  it('checkpointing off on a streaming job (zero counts, interval Long.MAX_VALUE) is Off too, not "None yet"', async () => {
    show(
      answer(
        200,
        detail,
        { ...ckpt, counts: { ...ckpt.counts, completed: 0, total: 0 }, latest: {} },
        {
          interval: 2 ** 63, // Long.MAX_VALUE as JSON.parse gives it
        },
      ),
    );
    const k = await screen.findByRole('group', { name: 'Last checkpoint' });
    await waitFor(() => expect(k).toHaveTextContent('Off'));
  });

  it('JOB-02 / D08e: a read-only connection says so (JOB-READONLY, info banner); a normal one does not', async () => {
    const { unmount } = show(answer(200, detail), {}, { ...conn, readOnly: true });
    await screen.findByRole('table', { name: 'Operators' });
    const note = await screen.findByText('This connection is read-only. Actions are hidden.');
    // An info Banner: a polite live region (role=status) that says its severity in words.
    const region = note.closest('[role="status"]');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent(/Info:/);
    unmount();
    show(answer(200, detail));
    await screen.findByRole('table', { name: 'Operators' });
    expect(screen.queryByText(/This connection is read-only/)).toBeNull();
  });

  it('JOB-05 / D08c: a restarting job says how often and why (JOB-RESTARTING, warning, root cause)', async () => {
    show(answer(200, { ...detail, state: 'RESTARTING' }));
    expect(
      await screen.findByText(
        // audit #1: the cause without the Java class wrapper (CLAUDE.md: never raw exception text as the message).
        'refund-matcher restarted 4 times in 12 min. Last cause: merchant_id is null.',
      ),
    ).toBeInTheDocument();
  });

  it('JOB-05 / D11: a failed job says so with its root cause (JOB-FAILED, error)', async () => {
    show(answer(200, { ...detail, state: 'FAILED' }));
    const t = await screen.findByText('refund-matcher failed: merchant_id is null.');
    expect(t.closest('[role="alert"]')).not.toBeNull();
    // audit #5: below the job header (D08c), not above the title.
    const h = screen.getByRole('heading', { level: 1 });
    expect(h.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('audit #2: a failed job whose exceptions can not be read says that, not nothing', async () => {
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 500, headers: {}, url: '', body: '' }
        : answer(200, { ...detail, state: 'FAILED' })(req),
    );
    expect(await screen.findByText(/internal error while reading the exceptions/)).toBeInTheDocument();
  });

  it('audit #3: 20 kept failures, all recent (Flink keeps at most 20 here): "20+ times"', async () => {
    const many = {
      exceptionHistory: {
        entries: Array.from({ length: 20 }, (_, i) => npe(detail.now - i * 30_000)),
        truncated: false,
      },
    };
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 200, headers: {}, url: '', body: JSON.stringify(many) }
        : answer(200, { ...detail, state: 'RESTARTING' })(req),
    );
    expect(await screen.findByText(/restarted 20\+ times in/)).toBeInTheDocument();
  });

  it('audit #4: RESTARTING → FAILED reads the exceptions again at once, naming the final failure', async () => {
    let state = 'RESTARTING';
    let excBody: unknown = excs;
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 200, headers: {}, url: '', body: JSON.stringify(excBody) }
        : answer(200, { ...detail, state })(req),
    );
    await screen.findByText(/restarted 4 times/);
    const final = { ...npe(detail.now), stacktrace: 'java.lang.IllegalStateException: no more restarts' };
    excBody = { exceptionHistory: { entries: [final], truncated: false } };
    state = 'FAILED';
    expect(
      await screen.findByText('refund-matcher failed: no more restarts.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('FAILING is not called "restarted": no banner until Flink says RESTARTING or FAILED', async () => {
    show(answer(200, { ...detail, state: 'FAILING' }));
    await screen.findByRole('table', { name: 'Operators' });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(/restarted/)).toBeNull();
  });

  it('JOB-05: a running job neither asks for exceptions nor shows a status banner', async () => {
    const paths: string[] = [];
    show(async (req) => (paths.push(req.path), answer(200, detail)(req)));
    await screen.findByRole('table', { name: 'Operators' });
    await new Promise((r) => setTimeout(r, 50));
    expect(paths.some((p) => p.endsWith('/exceptions'))).toBe(false);
    expect(screen.queryByText(/restarted|failed:/)).toBeNull();
  });

  it('lists the operators with parallelism and status', async () => {
    show(answer(200, detail));
    const table = await screen.findByRole('table', { name: 'Operators' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual([
      'Source: payments',
      'Window aggregate',
      'Sink: alerts',
    ]);
    expect(rows[2]).toHaveTextContent('2');
  });

  it('audit #1: a finished job says when it started, not how long it ran (D08d)', async () => {
    show(answer(200, { ...detail, state: 'FINISHED', duration: 3_600_000, 'end-time': 3_600_001 }));
    expect(await screen.findByText(/started 6 days ago/)).toBeInTheDocument();
  });

  it('audit #2: when the 404 page replaces the screen, focus is on its h1, not <body>', async () => {
    show(answer(404, { errors: ['Job not found'] }));
    await screen.findByText(/This job no longer exists/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('audit #3: one 404 over a loaded job is not the full-page state (§4: 1 failure is silent)', async () => {
    let n = 0;
    show(async (req) => (n++ === 0 ? answer(200, detail) : answer(404, { errors: ['x'] }))(req));
    await screen.findByRole('table', { name: 'Operators' });
    await waitFor(() => expect(n).toBeGreaterThan(1), { timeout: 4000 });
    expect(screen.queryByText(/This job no longer exists/)).toBeNull();
    expect(screen.getByRole('table', { name: 'Operators' })).toBeInTheDocument();
  });

  it('audit 2 #1: the cluster answers again after the 404 page: focus goes to the h1, not <body>', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let missing = true;
      show(async (req) => (missing ? answer(404, { errors: ['x'] }) : answer(200, detail))(req), {
        onJobs: vi.fn(),
      });
      const back = await screen.findByRole('button', { name: 'Back to list' });
      back.focus();
      missing = false;
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      await screen.findByRole('table', { name: 'Operators' });
      expect(screen.getByRole('heading', { level: 1, name: 'refund-matcher' })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a job the cluster no longer has is the API-404-JOB page with Back to list', async () => {
    const onJobs = vi.fn();
    show(answer(404, { errors: ['Job not found'] }), { onJobs });
    await waitFor(() =>
      expect(screen.getByText(/This job no longer exists on payments-prod/)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    expect(onJobs).toHaveBeenCalled();
  });
});
