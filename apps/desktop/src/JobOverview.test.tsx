import { type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JobOverview } from './JobOverview';

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
/** The job answers `body`; its checkpoints answer `cp` (stats; or an Error, or a config body for /config). */
const answer =
  (status: number, body: unknown, cp: unknown = ckpt, config: unknown = { interval: 10_000 }): FlinkHttp =>
  async (req) =>
    req.path.endsWith('/checkpoints/config')
      ? { status: 200, headers: {}, url: '', body: JSON.stringify(config) }
      : req.path.endsWith('/checkpoints')
        ? cp instanceof Error
          ? { status: 404, headers: {}, url: '', body: JSON.stringify({ errors: [cp.message] }) }
          : { status: 200, headers: {}, url: '', body: JSON.stringify(cp) }
        : { status, headers: {}, url: '', body: JSON.stringify(body) };
const show = (http: FlinkHttp, more: { onJobs?: () => void } = {}) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <JobOverview c={conn} jid={detail.jid} transport={() => http} {...more} />
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
    expect(k).toHaveTextContent('2 minutes ago');
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
    expect(screen.getByRole('table', { name: 'Operators' })).toBeInTheDocument();
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
