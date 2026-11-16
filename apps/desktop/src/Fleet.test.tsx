import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Fleet } from './Fleet';

const conn = (name: string, env: Connection['env'] = 'prod'): Connection => ({
  id: `c-${name}`,
  name,
  url: `https://${name}.example.com:8081`,
  kind: 'standalone',
  env,
  readOnly: false,
  basePath: '',
  auth: { type: 'none' },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: 10000,
  pollMs: 5000,
});
const ok = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), url: '' });
const healthy =
  (running: number): FlinkHttp =>
  async (req) =>
    ok(
      req.path === '/config'
        ? { 'flink-version': '2.3.0' }
        : req.path === '/overview'
          ? {
              taskmanagers: 2,
              'slots-total': 32,
              'slots-available': 6,
              'jobs-running': running,
              'jobs-finished': 0,
              'jobs-cancelled': 0,
              'jobs-failed': 0,
            }
          : { jobs: [{ jid: 'a', name: 'fraud-scoring', state: 'RESTARTING' }] },
    );
const show = (connections: Connection[], transport: (c: Connection) => FlinkHttp) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <Fleet connections={connections} transport={transport} onAdd={() => {}} onManage={() => {}} />
      </ToastProvider>
    </TooltipProvider>,
  );
const card = (name: string) => screen.getByRole('listitem', { name });

describe('FLEET-01 the fleet (boards D04, D04b, D04c, D04d)', () => {
  it('loading, then each card: Healthy, running, failing now, slots free, environment and version', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    show([conn('payments-prod'), conn('local-docker', 'dev')], (c) => async (req) => {
      await gate;
      return healthy(c.name === 'payments-prod' ? 13 : 3)(req);
    });
    expect(within(card('payments-prod')).getByText('Loading')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Fleet' }));
    await act(async () => release());
    expect(await within(card('payments-prod')).findByText('Healthy')).toBeTruthy();
    const prod = card('payments-prod').textContent;
    expect(prod).toContain('Running13');
    expect(prod).toContain('Failing1');
    expect(prod).toContain('Slots free6 / 32');
    expect(prod).toContain('Production · Flink 2.3.0');
    expect(await screen.findByText('2 connections · 18 jobs')).toBeTruthy();
  });
  it('an unreachable cluster keeps its card: the catalog message and Retry (D04b)', async () => {
    let down = true;
    show([conn('payments-staging', 'staging')], () => async (req) => {
      if (down)
        throw new TransportError({ kind: 'refused', host: 'payments-staging.example.com', port: 8081 });
      return healthy(9)(req);
    });
    const c = card('payments-staging');
    expect(await within(c).findByText('Unreachable')).toBeTruthy();
    expect(c.textContent).toMatch(/payments-staging\.example\.com/);
    down = false;
    await userEvent.click(within(c).getByRole('button', { name: 'Retry payments-staging' }));
    expect(await within(c).findByText('Healthy')).toBeTruthy();
  });
  it('offline: CONN-OFFLINE over the last data, and nothing is asked (D04d)', async () => {
    const http = vi.fn(healthy(13));
    show([conn('payments-prod')], () => http);
    expect(await within(card('payments-prod')).findByText('Healthy')).toBeTruthy();
    const calls = http.mock.calls.length;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(
      await screen.findByText(/You are offline\. Data is from just now; actions are paused\./),
    ).toBeTruthy();
    expect(within(card('payments-prod')).getByText('Healthy')).toBeTruthy();
    expect(http.mock.calls.length).toBe(calls);
    vi.restoreAllMocks();
  });
});
