import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Cluster } from './Cluster';

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
const tm = (n: number, free: number, blocked = false) => ({
  id: `tm${n}-6d1f0c`,
  path: `pekko.tcp://flink@10.0.4.2${n}:6122/user/rpc/taskmanager_0`,
  dataPort: 41_000,
  timeSinceLastHeartbeat: 1,
  slotsNumber: 4,
  freeSlots: free,
  blocked,
});
const answers: Record<string, unknown> = {
  '/config': { 'flink-version': '2.3.0' },
  '/overview': {
    taskmanagers: 2,
    'slots-total': 8,
    'slots-available': 2,
    'jobs-running': 3,
    'jobs-finished': 0,
    'jobs-cancelled': 0,
    'jobs-failed': 0,
  },
  '/jobs/overview': {
    jobs: [
      { jid: 'a', name: 'refund-matcher', state: 'RUNNING' },
      { jid: 'b', name: 'fraud-scoring', state: 'RESTARTING' },
      { jid: 'c', name: 'card-velocity', state: 'RUNNING' },
    ],
  },
  '/taskmanagers': { taskmanagers: [tm(1, 0), tm(2, 2, true)] },
};
const healthy: FlinkHttp = async (req) => ({
  status: 200,
  headers: {},
  url: '',
  body: JSON.stringify(answers[req.path]),
});
const show = (http: FlinkHttp, more: { onJobs?: () => void } = {}) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <Cluster c={conn} transport={() => http} {...more} />
      </ToastProvider>
    </TooltipProvider>,
  );

describe('FLEET-02 · Cluster overview and TaskManagers (boards D05, D05b)', () => {
  it('loading says so, then the KPIs from /overview and /jobs/overview', async () => {
    show(healthy);
    expect(screen.getByRole('status', { name: 'Loading payments-prod' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'payments-prod' })).toBeInTheDocument();
    expect(screen.getByText(/Flink 2\.3\.0/)).toBeInTheDocument();
    const kpi = (name: string) => screen.getByRole('group', { name });
    expect(kpi('Task slots')).toHaveTextContent('6 / 8 used');
    expect(kpi('Task slots')).toHaveTextContent('2 free');
    expect(kpi('TaskManagers')).toHaveTextContent('2');
    // Running = not done and not failing, as on the fleet card (D05: 13 running · 1 failing of 14).
    expect(kpi('Running jobs')).toHaveTextContent(/^Running jobs2/);
    expect(kpi('Running jobs')).toHaveTextContent('1 failing');
  });

  it('lists TaskManagers with address, used slots and a status in words (D05b)', async () => {
    show(healthy);
    const table = await screen.findByRole('table', { name: 'TaskManagers' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    // D05b Address: the host only (the id no longer contains it, so this checks the column).
    expect(within(rows[0]!).getByText('10.0.4.21')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('4/4');
    expect(within(rows[0]!).getByText('OK')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('2/4');
    expect(within(rows[1]!).getByText('Blocked')).toBeInTheDocument();
  });

  it('no TaskManagers registered says so (§6 empty state)', async () => {
    show(async (req) => ({
      status: 200,
      headers: {},
      url: '',
      body: JSON.stringify(req.path === '/taskmanagers' ? { taskmanagers: [] } : answers[req.path]),
    }));
    expect(await screen.findByRole('heading', { name: 'No TaskManagers registered' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'TaskManagers' })).toBeNull();
  });

  it('Jobs opens the jobs list', async () => {
    const onJobs = vi.fn();
    show(healthy, { onJobs });
    await userEvent.click(await screen.findByRole('button', { name: 'Jobs' }));
    expect(onJobs).toHaveBeenCalled();
  });

  it('a failed first load shows the catalog message and Retry', async () => {
    show(async () => {
      throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
    });
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(alert).toHaveTextContent(/Nothing is listening on payments-prod\.example\.com/),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
