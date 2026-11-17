import { type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  vertices: [v('v1', 'Source: payments', 4), v('v2', 'Window aggregate', 4), v('v3', 'Sink: alerts', 2)],
};
const answer =
  (status: number, body: unknown): FlinkHttp =>
  async () => ({ status, headers: {}, url: '', body: JSON.stringify(body) });
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
    expect(screen.getByText(/started 6 d ago · parallelism 4/)).toBeInTheDocument();
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
