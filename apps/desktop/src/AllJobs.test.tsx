import type { Connection, FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AllJobs } from './AllJobs';

const conn = (id: string, name: string) =>
  ({ id, name, url: `http://${id}:8081`, timeoutMs: 10_000 }) as unknown as Connection;
const prod = conn('p', 'payments-prod');
const staging = conn('s', 'payments-staging');
const row = (jid: string, name: string, state: string) => ({
  jid,
  name,
  state,
  'start-time': 1,
  'end-time': -1,
  duration: 60_000,
  'last-modification': 1,
});
const ok = (body: unknown) => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });
const show = (transport: (c: Connection) => FlinkHttp, onOpenJob = vi.fn()) => {
  render(
    <TooltipProvider>
      <ToastProvider>
        <AllJobs connections={[prod, staging]} transport={transport} onOpenJob={onOpenJob} />
      </ToastProvider>
    </TooltipProvider>,
  );
  return onOpenJob;
};

describe('JOB-11 · jobs across connections (board X18)', () => {
  it("lists every connection's jobs: job, connection, status in words; a job opens on its connection", async () => {
    const open = show(
      (c) => async () =>
        ok({
          jobs:
            c.id === 'p'
              ? [row('a1', 'fraud-scoring', 'RESTARTING')]
              : [row('b2', 'card-velocity', 'FAILED')],
        }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    const t = await screen.findByRole('table', { name: 'Jobs on all connections' });
    await vi.waitFor(() => expect(within(t).getAllByRole('row')).toHaveLength(3));
    expect(screen.getByText('All connections · 2 jobs')).toBeInTheDocument();
    const cells = within(t)
      .getAllByRole('row')
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      );
    expect(cells).toEqual([
      ['fraud-scoring', 'payments-prod', 'Restarting'],
      ['card-velocity', 'payments-staging', 'Failed'],
    ]);
    await userEvent.click(within(t).getByRole('button', { name: 'card-velocity' }));
    expect(open).toHaveBeenCalledWith('s', 'b2');
  });

  it('FLEET-PARTIAL names the connections that did not answer; Retry reads them again', async () => {
    let tries = 0;
    show(
      (c) => async () =>
        c.id === 's' && ++tries === 1
          ? { status: 503, headers: {}, url: '', body: '' }
          : ok({ jobs: [row(c.id + '1', `${c.id}-job`, 'RUNNING')] }),
    );
    expect(
      await screen.findByText(
        '1 connections did not answer (payments-staging). Their jobs are missing from this view.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('All connections · 1 job')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(screen.queryByText(/did not answer/)).toBeNull());
    expect(screen.getByText('All connections · 2 jobs')).toBeInTheDocument();
  });
});
