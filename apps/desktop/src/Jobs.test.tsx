import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Jobs } from './Jobs';

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
const job = (jid: string, name: string, state: string, duration: number) => ({
  jid,
  name,
  state,
  'start-time': 1,
  'end-time': -1,
  duration,
  'last-modification': 1,
});
const list = [
  job('a1', 'refund-matcher', 'RUNNING', 6 * 86_400_000),
  job('b2', 'fraud-scoring', 'RESTARTING', 12 * 60_000),
  job('c3', 'daily-totals', 'FINISHED', 3_600_000),
];
const answer =
  (jobs: unknown[]): FlinkHttp =>
  async () => ({ status: 200, headers: {}, body: JSON.stringify({ jobs }), url: '' });
const show = (http: FlinkHttp) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <Jobs c={conn} transport={() => http} />
      </ToastProvider>
    </TooltipProvider>,
  );
const names = () =>
  within(screen.getByRole('table', { name: 'Jobs' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.textContent);

describe('JOB-01 · Jobs list (boards D07, D07b, D07c, D07d)', () => {
  it('loading (D07d) says so, then lists the jobs with status words and uptime (D07)', async () => {
    show(answer(list));
    expect(screen.getByRole('status', { name: 'Loading jobs' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Jobs' })).toBeInTheDocument();
    expect(names()).toEqual(['refund-matcher', 'fraud-scoring', 'daily-totals']);
    expect(screen.getByText('3 jobs on payments-prod')).toBeInTheDocument();
    const fraud = screen.getByRole('row', { name: /fraud-scoring/ });
    expect(within(fraud).getByText('Restarting')).toBeInTheDocument();
    expect(within(fraud).getByText('12 min')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /refund-matcher/ })).getByText('6 d')).toBeInTheDocument();
    // A finished job has no uptime.
    expect(within(screen.getByRole('row', { name: /daily-totals/ })).getByText('—')).toBeInTheDocument();
  });

  it('chips filter and show their counts; the pressed one says so (D07b)', async () => {
    show(answer(list));
    await screen.findByRole('table', { name: 'Jobs' });
    const failing = screen.getByRole('button', { name: 'Failing 1' });
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(failing);
    expect(failing).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['fraud-scoring']);
  });

  it('search by name or ID', async () => {
    show(answer(list));
    await screen.findByRole('table', { name: 'Jobs' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'c3');
    expect(names()).toEqual(['daily-totals']);
  });

  it('sorts by a column header, by keyboard, and says the order (aria-sort)', async () => {
    show(answer(list));
    await screen.findByRole('table', { name: 'Jobs' });
    const byJob = screen.getByRole('button', { name: /^Job/ });
    byJob.focus();
    await userEvent.keyboard('{Enter}');
    expect(names()).toEqual(['daily-totals', 'fraud-scoring', 'refund-matcher']);
    expect(screen.getByRole('columnheader', { name: /^Job/ })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.keyboard('{Enter}');
    expect(names()).toEqual(['refund-matcher', 'fraud-scoring', 'daily-totals']);
    expect(screen.getByRole('columnheader', { name: /^Job/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('empty cluster (D07c)', async () => {
    show(answer([]));
    expect(await screen.findByRole('heading', { name: 'No jobs on this cluster yet' })).toBeInTheDocument();
  });

  it('a failed first load shows the catalog message, not a raw error', async () => {
    show(async () => {
      throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
    });
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(alert).toHaveTextContent(/Nothing is listening on payments-prod\.example\.com/),
    );
    expect(alert).not.toHaveTextContent('transport: refused');
  });
});
