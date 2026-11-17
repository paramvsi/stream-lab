import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { causeText, duration, JobOverview, size } from './JobOverview';

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
/** v1 → v2 by HASH, v2 → v3 FORWARD (board D08). */
const hashPlan = {
  nodes: [
    { id: 'v1' },
    { id: 'v2', inputs: [{ num: 0, id: 'v1', ship_strategy: 'HASH' }] },
    { id: 'v3', inputs: [{ num: 0, id: 'v2', ship_strategy: 'FORWARD' }] },
  ],
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

  it('audit #2: a failed job whose exceptions can not be read says that (after 3 in a row, §4), not nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let asked = 0;
      show(async (req) =>
        req.path.endsWith('/exceptions')
          ? (asked++, { status: 500, headers: {}, url: '', body: '' })
          : answer(200, { ...detail, state: 'FAILED' })(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await act(async () => vi.advanceTimersByTimeAsync(40_000));
      expect(await screen.findByText(/internal error while reading the exceptions/)).toBeInTheDocument();
      // audit 5 #2: and the user can ask again (Retry), not only wait out the back-off: a request goes out now.
      const before = asked;
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(asked).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('20 kept failures, all recent (a cluster that keeps more than the default 16): "20+ times"', async () => {
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

  it('audit 2 #1: FAILING (failed, still cancelling tasks; never back to RESTARTING) is JOB-FAILED', async () => {
    show(answer(200, { ...detail, state: 'FAILING' }));
    expect(await screen.findByText('refund-matcher failed: merchant_id is null.')).toBeInTheDocument();
  });

  it('audit 2 #2: 16 kept failures, all recent (Flink keeps 16 by default): "16+ times"', async () => {
    const many = {
      exceptionHistory: {
        entries: Array.from({ length: 16 }, (_, i) => npe(detail.now - i * 30_000)),
        truncated: false,
      },
    };
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 200, headers: {}, url: '', body: JSON.stringify(many) }
        : answer(200, { ...detail, state: 'RESTARTING' })(req),
    );
    expect(await screen.findByText(/restarted 16\+ times in/)).toBeInTheDocument();
  });

  it.each([
    ['io', /payments-prod\.example\.com/, true],
    ['refused', /Nothing is listening/, false],
  ] as const)(
    'audit 6 #2: a %s error on the exceptions read alone (the job reads fine) is said: %s → %s',
    async (kind, text, said) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let asked = 0;
        show(async (req) => {
          if (req.path.endsWith('/exceptions')) {
            asked++;
            throw new TransportError({
              kind,
              host: 'payments-prod.example.com',
              port: 8081,
              reason: 'connection reset',
            });
          }
          return answer(200, { ...detail, state: 'FAILED' })(req);
        });
        await screen.findByRole('table', { name: 'Operators' });
        for (let t = 0; t < 40; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000)); // renders between
        expect(asked).toBeGreaterThanOrEqual(3); // past the 3-in-a-row tolerance
        // A reset on one big response is this read's own problem; "nothing is listening" is the host's, so the
        // job poll's to say.
        if (said) expect(await screen.findByText(text)).toBeInTheDocument();
        else expect(screen.queryByText(text)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('audit 6 #1: when the error changes under focus (its Retry goes), focus goes to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let status = 500;
      show(async (req) =>
        req.path.endsWith('/exceptions')
          ? { status, headers: {}, url: '', body: JSON.stringify({ errors: ['x'] }) }
          : answer(200, { ...detail, state: 'FAILED' })(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await act(async () => vi.advanceTimersByTimeAsync(40_000));
      status = 404; // API-4XX: Copy details only, no Retry
      await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
      await act(async () => vi.advanceTimersByTimeAsync(100));
      await screen.findByText(/refused this request \(HTTP 404\)/);
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 7 #1: exceptions failing on and off (never 3 in a row, no banner) never pull focus to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      let headingFocus = 0;
      show(async (req) =>
        req.path.endsWith('/exceptions')
          ? n++ % 2
            ? { status: 200, headers: {}, url: '', body: JSON.stringify(excs) }
            : { status: 500, headers: {}, url: '', body: '' }
          : answer(200, { ...detail, state: 'RESTARTING' })(req),
      );
      const h = await screen.findByRole('heading', { level: 1 });
      h.addEventListener('focus', () => headingFocus++);
      for (let t = 0; t < 30; t++) {
        (document.activeElement as HTMLElement | null)?.blur(); // reading the table: focus on <body>
        await act(async () => vi.advanceTimersByTimeAsync(1_000));
      }
      expect(n).toBeGreaterThanOrEqual(3);
      expect(headingFocus).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 7 #2: the failed-read banner coming never takes focus from a control the user is in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(
        async (req) =>
          req.path.endsWith('/exceptions')
            ? { status: 500, headers: {}, url: '', body: '' }
            : answer(200, { ...detail, state: 'FAILED' })(req),
        { onJobs: vi.fn() },
      );
      const jobs = await screen.findByRole('button', { name: 'Jobs' });
      jobs.focus();
      for (let t = 0; t < 40; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      await screen.findByText(/internal error while reading the exceptions/);
      expect(jobs).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 8: the failed-read banner arriving while the user reads the table (focus on <body>) moves nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let headingFocus = 0;
      show(async (req) =>
        req.path.endsWith('/exceptions')
          ? { status: 500, headers: {}, url: '', body: '' }
          : answer(200, { ...detail, state: 'FAILED' })(req),
      );
      const h = await screen.findByRole('heading', { level: 1 });
      h.addEventListener('focus', () => headingFocus++);
      for (let t = 0; t < 40; t++) {
        (document.activeElement as HTMLElement | null)?.blur();
        await act(async () => vi.advanceTimersByTimeAsync(1_000));
      }
      await screen.findByText(/internal error while reading the exceptions/);
      expect(headingFocus).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 2 #4: a 404 on the exceptions read is not a "no longer exists" banner over a job on screen', async () => {
    let asked = 0;
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? (asked++,
          { status: 404, headers: {}, url: '', body: JSON.stringify({ errors: ['Job x not found'] }) })
        : answer(200, { ...detail, state: 'FAILED' })(req),
    );
    await screen.findByRole('table', { name: 'Operators' });
    await waitFor(() => expect(asked).toBeGreaterThan(0)); // the read did happen, and failed
    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });

  it('audit 3 #1 / audit 4 #2: exceptions that keep timing out are said after 3 in a row, not at once, not never', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      show(async (req) => {
        if (req.path.endsWith('/exceptions')) {
          n++;
          throw new TransportError({ kind: 'timeout', host: 'payments-prod.example.com', timeoutS: 10 });
        }
        return answer(200, { ...detail, state: 'FAILED' })(req);
      });
      await screen.findByRole('table', { name: 'Operators' });
      await waitFor(() => expect(n).toBeGreaterThanOrEqual(1));
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(screen.queryByText(/payments-prod\.example\.com/)).toBeNull(); // 1 failure: silent (§4)
      await act(async () => vi.advanceTimersByTimeAsync(40_000));
      expect(n).toBeGreaterThanOrEqual(3);
      expect(await screen.findByText(/payments-prod\.example\.com/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 3 #1: a 404 on the exceptions read that persists (3 in a row) is said as the HTTP refusal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(async (req) =>
        req.path.endsWith('/exceptions')
          ? { status: 404, headers: {}, url: '', body: JSON.stringify({ errors: ['x'] }) }
          : answer(200, { ...detail, state: 'FAILED' })(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await act(async () => vi.advanceTimersByTimeAsync(100));
      expect(screen.queryByText(/refused this request/)).toBeNull(); // audit 4 #5: one 404 is silent
      await act(async () => vi.advanceTimersByTimeAsync(40_000));
      expect(await screen.findByText(/refused this request \(HTTP 404\)/)).toBeInTheDocument();
      expect(screen.queryByText(/no longer exists/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit 3 #3: 15 recent failures under the cap are exact ("15", no "+")', async () => {
    const some = {
      exceptionHistory: {
        entries: Array.from({ length: 15 }, (_, i) => npe(detail.now - i * 30_000)),
        truncated: false,
      },
    };
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 200, headers: {}, url: '', body: JSON.stringify(some) }
        : answer(200, { ...detail, state: 'RESTARTING' })(req),
    );
    expect(await screen.findByText(/restarted 15 times in/)).toBeInTheDocument();
  });

  it('audit 2 #6: the cause keeps its message, even one that starts with a class name; never a bare "Class:"', () => {
    expect(causeText('java.io.IOException: IOException while writing to s3://bucket')).toBe(
      'IOException while writing to s3://bucket',
    );
    expect(causeText('java.lang.NullPointerException: merchant_id is null')).toBe('merchant_id is null');
    expect(causeText('java.lang.NullPointerException')).toBe('NullPointerException');
    expect(causeText('java.lang.IllegalStateException:')).toBe('IllegalStateException');
    expect(causeText('com.acme.ZahlungsFehlerÄ: kaputt')).toBe('kaputt'); // audit 3 #2: Unicode class names
  });

  it('JOB-05: a running job neither asks for exceptions nor shows a status banner', async () => {
    const paths: string[] = [];
    show(async (req) => (paths.push(req.path), answer(200, detail)(req)));
    await screen.findByRole('table', { name: 'Operators' });
    await new Promise((r) => setTimeout(r, 50));
    expect(paths.some((p) => p.endsWith('/exceptions'))).toBe(false);
    expect(screen.queryByText(/restarted|failed:/)).toBeNull();
  });

  it('JOB-08: the Exceptions tab shows the grouped failures; a healthy job reads them only once it is opened', async () => {
    const paths: string[] = [];
    show(async (req) => (paths.push(req.path), answer(200, detail)(req)));
    await screen.findByRole('table', { name: 'Operators' });
    expect(paths.some((p) => p.endsWith('/exceptions'))).toBe(false);
    await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
    expect(await screen.findByText('1 group, 4 occurrences')).toBeInTheDocument();
    expect(paths.some((p) => p.endsWith('/exceptions'))).toBe(true);
    expect(screen.getByRole('table', { name: 'Exceptions' })).toBeInTheDocument();
  });

  it('JOB-08: the Exceptions tab says when they can not be read, not "Loading" forever', async () => {
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 500, headers: {}, url: '', body: '' }
        : answer(200, detail)(req),
    );
    await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
    expect(await screen.findByText(/internal error while reading the exceptions/)).toBeInTheDocument();
  });

  it('audit tab M2: with the Exceptions tab open and the cluster down, one banner says it (no CONN copy in the tab)', async () => {
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
      await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
      for (let t = 0; t < 40; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByText(/Lost contact with payments-prod/)).toBeInTheDocument();
      expect(screen.queryByText(/Nothing is listening/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit tab M3: a FAILED job with the Exceptions tab open shows the read error in the tab, once, not "Loading"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(async (req) =>
        req.path.endsWith('/exceptions')
          ? { status: 500, headers: {}, url: '', body: '' }
          : answer(200, { ...detail, state: 'FAILED' })(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
      for (let t = 0; t < 40; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getAllByText(/internal error while reading the exceptions/)).toHaveLength(1);
      expect(screen.queryByRole('status', { name: 'Loading exceptions' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit tab M4: Retry in the tab that works leaves focus on the heading, not <body>', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let bad = true;
      show(async (req) =>
        req.path.endsWith('/exceptions') && bad
          ? { status: 500, headers: {}, url: '', body: '' }
          : answer(200, detail)(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      const retry = await screen.findByRole('button', { name: 'Retry' });
      bad = false;
      await userEvent.click(retry);
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      await screen.findByRole('table', { name: 'Exceptions' });
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit tab #1: a full history (16, Flink\'s default) says "16+" in the tab pill and the table', async () => {
    const many = {
      exceptionHistory: {
        entries: Array.from({ length: 16 }, (_, i) => npe(detail.now - i * 30_000)),
        truncated: false,
      },
    };
    show(async (req) =>
      req.path.endsWith('/exceptions')
        ? { status: 200, headers: {}, url: '', body: JSON.stringify(many) }
        : answer(200, detail)(req),
    );
    await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
    expect(await screen.findByText('1 group, 16+ occurrences')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Exceptions/ })).toHaveTextContent('16+');
  });

  it('audit tab #2: exceptions that stop answering after a good read say so (stale), not silently old', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let bad = false;
      show(async (req) =>
        req.path.endsWith('/exceptions') && bad
          ? { status: 500, headers: {}, url: '', body: '' }
          : answer(200, detail)(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await userEvent.click(screen.getByRole('tab', { name: /Exceptions/ }));
      await screen.findByRole('table', { name: 'Exceptions' });
      bad = true;
      for (let t = 0; t < 30; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByText(/Not answering\. Showing data from/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('JOB-12: a Checkpoints tab after Exceptions (D08 order) shows the checkpoint history', async () => {
    show(answer(200, detail));
    await screen.findByRole('table', { name: 'Operators' });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\d+\+?$/, '').trim());
    expect(tabs).toEqual(['Overview', 'Exceptions', 'Checkpoints']);
    await userEvent.click(screen.getByRole('tab', { name: 'Checkpoints' }));
    expect(await screen.findByRole('group', { name: 'Completed' })).toHaveTextContent(/^Completed9$/);
  });

  it('audit ckpt #1: the Checkpoints tab says its data is old when reads fail after a good one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let bad = false;
      show(async (req) =>
        req.path.endsWith('/checkpoints') && bad
          ? { status: 500, headers: {}, url: '', body: '' }
          : answer(200, detail)(req),
      );
      await screen.findByRole('table', { name: 'Operators' });
      await userEvent.click(screen.getByRole('tab', { name: 'Checkpoints' }));
      await screen.findByRole('table', { name: 'Checkpoints' });
      bad = true;
      for (let t = 0; t < 30; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      const panel = screen.getByRole('tabpanel');
      expect(within(panel).getByText(/Not answering\. Showing data from/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit ckpt #3: a working Retry in the Checkpoints tab keeps focus on the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let ckBad = true;
      show(async (req) => {
        if (req.path.endsWith('/checkpoints') && ckBad)
          return { status: 500, headers: {}, url: '', body: '' };
        return answer(200, detail)(req);
      });
      await screen.findByRole('table', { name: 'Operators' });
      await userEvent.click(screen.getByRole('tab', { name: 'Checkpoints' }));
      const retry = await screen.findByRole('button', { name: 'Retry' });
      ckBad = false;
      await userEvent.click(retry);
      for (let t = 0; t < 3; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      await screen.findByRole('table', { name: 'Checkpoints' });
      expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['Overview', 'Checkpoints'])(
    'audit ckpt 2: checkpoints never loaded, then the cluster drops: only Lost contact says it (%s tab)',
    async (tabName) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let down = false;
        show(async (req) => {
          if (down)
            throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
          if (req.path.endsWith('/checkpoints')) return { status: 500, headers: {}, url: '', body: '' };
          return answer(200, detail)(req);
        });
        await screen.findByRole('table', { name: 'Operators' });
        await userEvent.click(screen.getByRole('tab', { name: tabName }));
        down = true;
        for (let t = 0; t < 40; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.getByText(/Lost contact with payments-prod/)).toBeInTheDocument();
        expect(screen.queryByText(/Nothing is listening/)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('JOB-02: the Overview tab shows the job graph (D08), its operators in flow order', async () => {
    const plan = {
      nodes: [
        { id: 'v1' },
        { id: 'v2', inputs: [{ num: 0, id: 'v1', ship_strategy: 'HASH' }] },
        { id: 'v3', inputs: [{ num: 0, id: 'v2' }] },
      ],
    };
    show(answer(200, { ...detail, plan }));
    const g = await screen.findByRole('list', { name: 'Job graph' });
    expect(
      within(g)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Source: payments', 'Window aggregate', 'Sink: alerts']);
  });

  it("JOB-BACKPRESSURE: a running job reads each operator's backpressure and badges the HIGH one", async () => {
    const bp = (v: string) => ({
      status: 'ok',
      backpressureLevel: v === 'v2' ? 'high' : 'ok',
      subtasks: [{ ratio: v === 'v2' ? 0.97 : 0.02 }],
    });
    show(async (req) => {
      const m = /\/vertices\/(v\d)\/backpressure$/.exec(req.path);
      if (m) return { status: 200, headers: {}, url: '', body: JSON.stringify(bp(m[1]!)) };
      return answer(200, detail)(req);
    });
    expect(await screen.findByText('backpressured 97%')).toBeInTheDocument();
  });

  it('JOB-BACKPRESSURE: a job that is not running asks for no backpressure', async () => {
    const paths: string[] = [];
    show(async (req) => (paths.push(req.path), answer(200, { ...detail, state: 'FINISHED' })(req)));
    await screen.findByRole('list', { name: 'Job graph' });
    await new Promise((r) => setTimeout(r, 100));
    expect(paths.some((p) => p.endsWith('/backpressure'))).toBe(false);
  });

  it(
    'audit bp #1: all polls of one connection share at most 6 requests in flight (FLINK_API)',
    { timeout: 15_000 },
    async () => {
      let inFlight = 0;
      let most = 0;
      const many = {
        ...detail,
        vertices: Array.from({ length: 30 }, (_, i) => ({ ...detail.vertices[0]!, id: `x${i}` })),
      };
      show(async (req) => {
        inFlight++;
        most = Math.max(most, inFlight);
        // Slow backpressure (5 waves of 6 take ~5 s): the job poll's next 2 s tick lands among them.
        await new Promise((r) => setTimeout(r, req.path.endsWith('/backpressure') ? 1000 : 50));
        inFlight--;
        return req.path.endsWith('/backpressure')
          ? {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify({ status: 'ok', backpressureLevel: 'ok', subtasks: [] }),
            }
          : answer(200, many)(req);
      });
      await screen.findByRole('list', { name: 'Job graph' }, { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 3500));
      expect(most).toBeGreaterThan(1);
      expect(most).toBeLessThanOrEqual(6);
    },
  );

  it('audit bp #2: when every backpressure read fails, the badge stays (the data stays, §4), not "no backpressure"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let bad = false;
      show(async (req) => {
        if (req.path.endsWith('/backpressure'))
          return bad
            ? { status: 500, headers: {}, url: '', body: '' }
            : {
                status: 200,
                headers: {},
                url: '',
                body: JSON.stringify({
                  status: 'ok',
                  backpressureLevel: 'high',
                  subtasks: [{ ratio: 0.97 }],
                }),
              };
        return answer(200, detail)(req);
      });
      await screen.findAllByText('backpressured 97%');
      bad = true;
      for (let t = 0; t < 12; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getAllByText('backpressured 97%').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it(
    'audit bp2 #1: on a large job the job poll never waits behind backpressure reads (they use one slot)',
    { timeout: 15_000 },
    async () => {
      let inFlightBp = 0;
      let mostBp = 0;
      const many = {
        ...detail,
        vertices: Array.from({ length: 30 }, (_, i) => ({ ...detail.vertices[0]!, id: `x${i}` })),
      };
      show(async (req) => {
        if (req.path.endsWith('/backpressure')) {
          inFlightBp++;
          mostBp = Math.max(mostBp, inFlightBp);
          await new Promise((r) => setTimeout(r, 200));
          inFlightBp--;
          return {
            status: 200,
            headers: {},
            url: '',
            body: JSON.stringify({ status: 'ok', backpressureLevel: 'ok', subtasks: [] }),
          };
        }
        return answer(200, many)(req);
      });
      await screen.findByRole('list', { name: 'Job graph' }, { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 1500));
      expect(mostBp).toBe(1);
    },
  );

  it(
    'audit bp2 #2: a vertex whose reads keep failing loses its old badge once it is over 60 s old (no old reading that looks current)',
    { timeout: 20_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let bad = false;
        const ok = (lvl: string, r: number) => ({
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify({ status: 'ok', backpressureLevel: lvl, subtasks: [{ ratio: r }] }),
        });
        show(async (req) => {
          const m = /\/vertices\/(v\d)\/backpressure$/.exec(req.path);
          if (m)
            return m[1] === 'v2'
              ? bad
                ? { status: 500, headers: {}, url: '', body: '' }
                : ok('high', 0.97)
              : ok('ok', 0.01);
          return answer(200, detail)(req);
        });
        await screen.findByText('backpressured 97%');
        bad = true;
        for (let t = 0; t < 70; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.queryByText('backpressured 97%')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp3: hung backpressure reads: the round ends within one interval and the graph says its readings are old',
    { timeout: 20_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let hang = false;
        show(async (req) => {
          if (req.path.endsWith('/backpressure')) {
            // Hangs until the request's own timeoutMs, as the transport contract says (FLINK_API: Rust enforces it).
            if (hang) {
              await new Promise((r) => setTimeout(r, req.timeoutMs ?? 10_000));
              throw new TransportError({ kind: 'timeout', host: 'payments-prod.example.com', timeoutS: 2 });
            }
            return {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify({ status: 'ok', backpressureLevel: 'high', subtasks: [{ ratio: 0.97 }] }),
            };
          }
          return answer(200, detail)(req);
        });
        await screen.findAllByText('backpressured 97%');
        hang = true;
        for (let t = 0; t < 30; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        const g = screen.getByRole('region', { name: 'Job graph' }).parentElement!;
        expect(within(g).getByText(/Backpressure: not answering/)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp4 #1: on a job too big to read in one round, every operator is read in turn (the last ones too)',
    { timeout: 20_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const many = {
          ...detail,
          vertices: Array.from({ length: 12 }, (_, i) => ({
            ...detail.vertices[0]!,
            id: `x${i}`,
            name: `op ${i}`,
          })),
        };
        show(async (req) => {
          const m = /\/vertices\/(x\d+)\/backpressure$/.exec(req.path);
          if (m) {
            await new Promise((r) => setTimeout(r, 1_000)); // 12 reads take 12 s: more than one 5 s round
            const last = m[1] === 'x11';
            return {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify({
                status: 'ok',
                backpressureLevel: last ? 'high' : 'ok',
                subtasks: [{ ratio: last ? 0.9 : 0 }],
              }),
            };
          }
          return answer(200, many)(req);
        });
        await screen.findByRole('list', { name: 'Job graph' });
        for (let t = 0; t < 40; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.getByText('backpressured 90%')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp5: on a big slow job a badge, once read, never blinks to "no reading" in rounds that did not reach it',
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const many = {
          ...detail,
          vertices: Array.from({ length: 24 }, (_, i) => ({
            ...detail.vertices[0]!,
            id: `x${i}`,
            name: `op ${i}`,
          })),
        };
        show(async (req) => {
          const m = /\/vertices\/(x\d+)\/backpressure$/.exec(req.path);
          if (m) {
            await new Promise((r) => setTimeout(r, 1_000)); // ~6 of 24 per round
            const hot = m[1] === 'x0';
            return {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify({
                status: 'ok',
                backpressureLevel: hot ? 'high' : 'ok',
                subtasks: [{ ratio: hot ? 0.9 : 0 }],
              }),
            };
          }
          return answer(200, many)(req);
        });
        await screen.findByRole('list', { name: 'Job graph' });
        for (let t = 0; t < 10 && !screen.queryByText('backpressured 90%'); t++)
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.getByText('backpressured 90%')).toBeInTheDocument();
        let blinks = 0;
        for (let t = 0; t < 40; t++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
          if (!screen.queryByText('backpressured 90%')) blinks++;
        }
        expect(blinks).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp6: operators whose reads fail in rounds that fail as a whole still lose their badge after 60 s',
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        // 6 fast healthy operators, then 6 on a sick TaskManager: read once (s5 HIGH), then every read times out.
        const ids = [
          ...Array.from({ length: 6 }, (_, i) => `f${i}`),
          ...Array.from({ length: 6 }, (_, i) => `s${i}`),
        ];
        const many = {
          ...detail,
          vertices: ids.map((id) => ({ ...detail.vertices[0]!, id, name: `op ${id}` })),
        };
        let sick = false;
        show(async (req) => {
          const m = /\/vertices\/(\w\d)\/backpressure$/.exec(req.path);
          if (m) {
            if (sick && m[1]!.startsWith('s')) {
              await new Promise((r) => setTimeout(r, req.timeoutMs ?? 10_000));
              throw new TransportError({ kind: 'timeout', host: 'payments-prod.example.com', timeoutS: 2 });
            }
            const hot = m[1] === 's5';
            return {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify({
                status: 'ok',
                backpressureLevel: hot ? 'high' : 'ok',
                subtasks: [{ ratio: hot ? 0.8 : 0 }],
              }),
            };
          }
          return answer(200, many)(req);
        });
        await screen.findByRole('list', { name: 'Job graph' });
        for (let t = 0; t < 10 && !screen.queryByText('backpressured 80%'); t++)
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.getByText('backpressured 80%')).toBeInTheDocument();
        sick = true;
        for (let t = 0; t < 90; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.queryByText('backpressured 80%')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp7 #1: when every read fails, a badge still goes once its reading is over 60 s old; the note claims no age',
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let down = false;
        show(async (req) => {
          if (req.path.endsWith('/backpressure'))
            return down
              ? { status: 500, headers: {}, url: '', body: '' }
              : {
                  status: 200,
                  headers: {},
                  url: '',
                  body: JSON.stringify({
                    status: 'ok',
                    backpressureLevel: 'high',
                    subtasks: [{ ratio: 0.97 }],
                  }),
                };
          return answer(200, detail)(req);
        });
        await screen.findAllByText('backpressured 97%');
        down = true;
        for (let t = 0; t < 80; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.queryByText('backpressured 97%')).toBeNull();
        const g = screen.getByRole('region', { name: 'Job graph' }).parentElement!;
        expect(within(g).getByText(/Backpressure: not answering/)).not.toHaveTextContent(/data from/);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp7 #2: after a restart, a reading from before it never comes back as current',
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let state = 'RUNNING';
        let after = false;
        show(async (req) => {
          if (req.path.endsWith('/backpressure'))
            return after && req.path.includes('/v2/') // after the restart: v2 fails, the others answer ok
              ? { status: 500, headers: {}, url: '', body: '' }
              : {
                  status: 200,
                  headers: {},
                  url: '',
                  body: JSON.stringify({
                    status: 'ok',
                    backpressureLevel: after ? 'ok' : 'high',
                    subtasks: [{ ratio: after ? 0 : 0.97 }],
                  }),
                };
          return answer(200, { ...detail, state })(req);
        });
        await screen.findAllByText('backpressured 97%');
        state = 'RESTARTING';
        after = true;
        for (let t = 0; t < 4; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        state = 'RUNNING';
        for (let t = 0; t < 12; t++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
          expect(screen.queryByText('backpressured 97%')).toBeNull();
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    'audit bp8: a read in flight across a restart, and the badges from before it, never show after it',
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let state = 'RUNNING';
        let after = false;
        show(async (req) => {
          if (req.path.endsWith('/backpressure')) {
            const hot = !after; // decided when asked: a read sent before the restart answers HIGH after it
            await new Promise((r) => setTimeout(r, 1_500));
            return {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify({
                status: 'ok',
                backpressureLevel: hot ? 'high' : 'ok',
                subtasks: [{ ratio: hot ? 0.97 : 0 }],
              }),
            };
          }
          return answer(200, { ...detail, state })(req);
        });
        await screen.findByRole('list', { name: 'Job graph' });
        for (let t = 0; t < 10 && !screen.queryAllByText('backpressured 97%').length; t++)
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.queryAllByText('backpressured 97%').length).toBeGreaterThan(0);
        await act(async () => vi.advanceTimersByTimeAsync(5_500)); // the next round is now mid-read
        state = 'RESTARTING';
        await act(async () => vi.advanceTimersByTimeAsync(2_500));
        after = true;
        state = 'RUNNING';
        for (let t = 0; t < 12; t++) {
          await act(async () => vi.advanceTimersByTimeAsync(500));
          expect(screen.queryAllByText('backpressured 97%')).toHaveLength(0);
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('JOB-03 / D09c: an operator row opens its panel: subtasks with records in and busy, the skew line, failures said', async () => {
    const rec = [2410, 820, 860, 790];
    show(async (req) => {
      const m = /\/vertices\/v2\/subtasks\/(\d)\/metrics$/.exec(req.path);
      if (m) {
        const i = Number(m[1]);
        if (i === 3) return { status: 500, headers: {}, url: '', body: '' };
        return {
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify([
            { id: 'numRecordsInPerSecond', value: String(rec[i]) },
            { id: 'busyTimeMsPerSecond', value: String([990, 340, 360, 330][i]) },
          ]),
        };
      }
      return answer(200, detail)(req);
    });
    const ops = await screen.findByRole('table', { name: 'Operators' });
    const row = within(ops).getAllByRole('row')[2]!; // Window aggregate
    row.focus();
    await userEvent.keyboard('{Enter}');
    const panel = await screen.findByRole('region', { name: 'Window aggregate' });
    const t = await within(panel).findByRole('table', { name: 'Subtasks' });
    const rows = within(t)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    expect(rows[0]).toMatch(/^0.*2,410\/s.*99%/);
    expect(rows[3]).toMatch(/^3.*—.*—/);
    expect(within(panel).getByText(/1 subtask could not be read/)).toBeInTheDocument();
    // 3 of 4 read: no skew claim from a partial table
    expect(within(panel).queryByText(/× the records/)).toBeNull();
  });

  it('JOB-03 / D09c: over a complete table, a skewed operator says which subtask gets how much more', async () => {
    const rec = [2410, 820, 860, 790];
    show(async (req) => {
      const m = /\/vertices\/v2\/subtasks\/(\d)\/metrics$/.exec(req.path);
      if (m)
        return {
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify([{ id: 'numRecordsInPerSecond', value: String(rec[Number(m[1])]) }]),
        };
      return answer(200, detail)(req);
    });
    const ops = await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(within(ops).getAllByRole('row')[2]!);
    const panel = await screen.findByRole('region', { name: 'Window aggregate' });
    expect(await within(panel).findByText('Subtask 0 gets 2.9× the records')).toBeInTheDocument();
  });

  it("audit op #1: switching operators never shows the last one's subtasks under the new name", async () => {
    show(async (req) => {
      const m = /\/vertices\/(v\d)\/subtasks\/(\d)\/metrics$/.exec(req.path);
      if (m) {
        if (m[1] === 'v3') await new Promise(() => {}); // the new operator has not answered yet
        return {
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify([{ id: 'numRecordsInPerSecond', value: '2410' }]),
        };
      }
      return answer(200, detail)(req);
    });
    const ops = await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(within(ops).getAllByRole('row')[2]!);
    await within(await screen.findByRole('region', { name: 'Window aggregate' })).findAllByText('2,410/s');
    await userEvent.click(within(ops).getAllByRole('row')[3]!);
    const p = await screen.findByRole('region', { name: 'Sink: alerts' });
    expect(within(p).queryByText('2,410/s')).toBeNull();
  });

  it(
    "audit op #2 #4: a job not running sends no subtask reads; a host down is the page's to say, a timeout the panel's",
    { timeout: 25_000 },
    async () => {
      let reads = 0;
      let state = 'FINISHED';
      let kind: 'refused' | 'timeout' = 'refused';
      show(async (req) => {
        if (/\/subtasks\/\d\/metrics$/.test(req.path)) {
          reads++;
          throw kind === 'refused'
            ? new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 })
            : new TransportError({ kind: 'timeout', host: 'payments-prod.example.com', timeoutS: 2 });
        }
        return answer(200, { ...detail, state })(req);
      });
      const ops = await screen.findByRole('table', { name: 'Operators' });
      await userEvent.click(within(ops).getAllByRole('row')[2]!);
      const p = await screen.findByRole('region', { name: 'Window aggregate' });
      await new Promise((r) => setTimeout(r, 300));
      expect(reads).toBe(0);
      state = 'RUNNING';
      await waitFor(() => expect(reads).toBeGreaterThan(0), { timeout: 5_000 });
      await new Promise((r) => setTimeout(r, 300));
      // A host refusing is the job poll's to say (as for the exceptions and checkpoint reads), also around an
      // outage while this read still holds its error: the panel is silent.
      expect(within(p).queryByText(/could not be read/)).toBeNull();
      // A timeout can hit this one read while the job answers: the panel says it (never a skeleton forever).
      kind = 'timeout';
      expect(
        await within(p).findByText(/Subtasks could not be read/, {}, { timeout: 15_000 }),
      ).toBeInTheDocument();
      expect(within(p).queryByRole('button', { name: /Retry/ })).toBeNull();
    },
  );

  it(
    "audit op #3: switching operators ends the last one's round: no more reads for it",
    { timeout: 20_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const reads: Record<string, number> = {};
        show(async (req) => {
          const m = /\/vertices\/(v\d)\/subtasks\/\d\/metrics$/.exec(req.path);
          if (m) {
            reads[m[1]!] = (reads[m[1]!] ?? 0) + 1;
            await new Promise((r) => setTimeout(r, 1_000));
            return { status: 200, headers: {}, url: '', body: '[]' };
          }
          return answer(200, detail)(req);
        });
        const ops = await screen.findByRole('table', { name: 'Operators' });
        await userEvent.click(within(ops).getAllByRole('row')[2]!); // Window aggregate, p 4: 4 s a round
        await act(async () => vi.advanceTimersByTimeAsync(1_500));
        await userEvent.click(within(ops).getAllByRole('row')[3]!);
        const at = reads.v2!;
        for (let t = 0; t < 8; t++) await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(reads.v2).toBe(at);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "audit op2 #1: while the page's own banner is up, the panel does not say the same outage again",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let down = false;
        show(async (req) => {
          if (down)
            throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
          if (/\/subtasks\/\d\/metrics$/.test(req.path)) {
            // no table yet: each read times out (at its timeoutMs, as the transport contract says)
            await new Promise((r) => setTimeout(r, req.timeoutMs ?? 10_000));
            throw new TransportError({ kind: 'timeout', host: 'payments-prod.example.com', timeoutS: 2 });
          }
          return answer(200, detail)(req);
        });
        const ops = await screen.findByRole('table', { name: 'Operators' });
        await userEvent.click(within(ops).getAllByRole('row')[2]!);
        const p = await screen.findByRole('region', { name: 'Window aggregate' });
        down = true;
        for (let t = 0; t < 20 && !screen.queryByText(/Lost contact with payments-prod/); t++)
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
        expect(screen.getByText(/Lost contact with payments-prod/)).toBeInTheDocument();
        expect(within(p).queryByText(/could not be read/)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("JOB-03 / D09b: the Watermarks tab lists each subtask's watermark and lag, names the one holding back, says ended", async () => {
    const now = detail.now;
    show(async (req) => {
      if (req.path.endsWith('/vertices/v2/watermarks'))
        return {
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify([
            { id: '0.currentInputWatermark', value: String(now - 41_000) },
            { id: '1.currentInputWatermark', value: String(now - 2_000) },
            { id: '2.currentInputWatermark', value: String(now - 1_000) },
            { id: '3.currentInputWatermark', value: '9223372036854775807' },
          ]),
        };
      if (req.path.includes('/subtasks/')) return { status: 200, headers: {}, url: '', body: '[]' };
      return answer(200, { ...detail, plan: hashPlan })(req);
    });
    const ops = await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(within(ops).getAllByRole('row')[2]!);
    const p = await screen.findByRole('region', { name: 'Window aggregate' });
    await userEvent.click(within(p).getByRole('tab', { name: 'Watermarks' }));
    const t = await within(p).findByRole('table', { name: 'Watermarks' });
    const rows = within(t)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    expect(rows[0]).toMatch(/41 s · holding back/);
    expect(rows[1]).toMatch(/2 s$/);
    expect(rows[3]).toMatch(/Input ended/);
    const said = within(p).getByText(
      /Subtask 0 is 39 s behind the others, so the operator's watermark waits for it\./,
    );
    // Behind a HASH edge every subtask sees every input: one lagging subtask is itself slow, not an idle partition.
    expect(said).toHaveTextContent(/busy or gets more records/);
    expect(said).not.toHaveTextContent(/idleness/);
    // Flink caches REST metrics (metrics.fetcher.update-interval, 10 s by default): said, not hidden.
    expect(within(p).getByText(/can read up to 10 s high/)).toBeInTheDocument();
  });

  it('audit wm2 #1 #2: fed from a source point-to-point (RESCALE), one lagging subtask gets the idleness hint; a source itself has no input watermark', async () => {
    const now = detail.now;
    const plan = {
      nodes: [
        { id: 'v1' },
        { id: 'v2', inputs: [{ num: 0, id: 'v1', ship_strategy: 'RESCALE' }] },
        { id: 'v3', inputs: [{ num: 0, id: 'v2', ship_strategy: 'HASH' }] },
      ],
    };
    show(async (req) => {
      if (req.path.endsWith('/vertices/v2/watermarks'))
        return {
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify([
            { id: '0.currentInputWatermark', value: String(now - 1_000) },
            { id: '1.currentInputWatermark', value: String(now - 1_500) },
            { id: '2.currentInputWatermark', value: String(now - 60_000) },
            { id: '3.currentInputWatermark', value: String(now - 1_200) },
          ]),
        };
      // A source registers no input watermark gauge (SourceOperatorStreamTask): Flink sends none.
      if (req.path.endsWith('/vertices/v1/watermarks'))
        return { status: 200, headers: {}, url: '', body: '[]' };
      if (req.path.includes('/subtasks/')) return { status: 200, headers: {}, url: '', body: '[]' };
      return answer(200, { ...detail, plan })(req);
    });
    const ops = await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(within(ops).getAllByRole('row')[2]!); // Window aggregate, fed by RESCALE
    let p = await screen.findByRole('region', { name: 'Window aggregate' });
    await userEvent.click(within(p).getByRole('tab', { name: 'Watermarks' }));
    expect(await within(p).findByText(/consider an idleness timeout/)).toBeInTheDocument();
    await userEvent.click(within(ops).getAllByRole('row')[1]!); // Source: payments
    p = await screen.findByRole('region', { name: 'Source: payments' });
    await userEvent.click(within(p).getByRole('tab', { name: 'Watermarks' }));
    expect(await within(p).findByText(/A source has no input watermark/)).toBeInTheDocument();
    expect(within(p).queryByRole('table', { name: 'Watermarks' })).toBeNull();
  });

  it(
    "audit wm #1: lag is measured at its read, so it does not swing with the job poll (Flink's own 10 s metric cache aside)",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        show(async (req) => {
          if (req.path.endsWith('/vertices/v2/watermarks'))
            return {
              status: 200,
              headers: {},
              url: '',
              body: JSON.stringify([{ id: '0.currentInputWatermark', value: String(Date.now() - 2_000) }]),
            };
          if (req.path.includes('/subtasks/')) return { status: 200, headers: {}, url: '', body: '[]' };
          return answer(200, { ...detail, plan: hashPlan, now: Date.now() })(req);
        });
        const ops = await screen.findByRole('table', { name: 'Operators' });
        await userEvent.click(within(ops).getAllByRole('row')[2]!);
        const p = await screen.findByRole('region', { name: 'Window aggregate' });
        await userEvent.click(within(p).getByRole('tab', { name: 'Watermarks' }));
        await within(p).findByRole('table', { name: 'Watermarks' });
        const seen = new Set<string>();
        for (let t = 0; t < 12; t++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000));
          const t2 = within(p).getByRole('table', { name: 'Watermarks' });
          seen.add(within(within(t2).getAllByRole('row')[1]!).getAllByRole('cell').at(-1)!.textContent!);
        }
        expect([...seen]).toEqual(['2 s']);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('audit wm3: no plan is no proof of a source (the table shows); a source feeding nothing is not sent elsewhere', async () => {
    let plan: unknown = undefined;
    show(async (req) => {
      if (/\/vertices\/v\d\/watermarks$/.test(req.path))
        return {
          status: 200,
          headers: {},
          url: '',
          body: JSON.stringify([{ id: '0.currentInputWatermark', value: String(detail.now - 1_000) }]),
        };
      if (req.path.includes('/subtasks/')) return { status: 200, headers: {}, url: '', body: '[]' };
      return answer(200, plan === undefined ? detail : { ...detail, plan })(req);
    });
    const ops = await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(within(ops).getAllByRole('row')[2]!);
    let p = await screen.findByRole('region', { name: 'Window aggregate' });
    await userEvent.click(within(p).getByRole('tab', { name: 'Watermarks' }));
    expect(await within(p).findByRole('table', { name: 'Watermarks' })).toBeInTheDocument();
    expect(within(p).queryByText(/A source has no input watermark/)).toBeNull();
    cleanup();
    plan = { nodes: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }] }; // parsed: three unconnected vertices
    show(async (req) => answer(200, { ...detail, plan })(req));
    const ops2 = await screen.findByRole('table', { name: 'Operators' });
    await userEvent.click(within(ops2).getAllByRole('row')[1]!);
    p = await screen.findByRole('region', { name: 'Source: payments' });
    await userEvent.click(within(p).getByRole('tab', { name: 'Watermarks' }));
    const said = await within(p).findByText(/A source has no input watermark/);
    expect(said).not.toHaveTextContent(/operators it feeds/);
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
