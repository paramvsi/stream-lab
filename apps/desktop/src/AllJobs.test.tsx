import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
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
const show = (transport: (c: Connection) => FlinkHttp, onOpenJob = vi.fn(), onFleet = vi.fn()) => {
  render(
    <TooltipProvider>
      <ToastProvider>
        <AllJobs
          connections={[prod, staging]}
          transport={transport}
          onOpenJob={onOpenJob}
          onFleet={onFleet}
        />
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

  it('audit of 314460c #1–#3: Fleet goes back; Retry re-reads only who failed, keeps focus, and drops no answer in flight', async () => {
    const asked = { p: 0, s: 0 };
    let release = () => {};
    const onFleet = vi.fn();
    show(
      (c) => async () => {
        asked[c.id as 'p' | 's']++;
        if (c.id === 's' && asked.s === 1) return { status: 503, headers: {}, url: '', body: '' };
        if (c.id === 'p') await new Promise<void>((r) => (release = r)); // prod is slow
        return ok({ jobs: [row(c.id + '1', `${c.id}-job`, 'RUNNING')] });
      },
      vi.fn(),
      onFleet,
    );
    await screen.findByText(/did not answer/);
    expect(screen.getByText('Reading the jobs of 1 connection…')).toBeInTheDocument(); // #4: not "0 jobs" silently
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    await vi.waitFor(() => expect(screen.getByText('s-job')).toBeInTheDocument());
    release(); // prod's first read answers, after the Retry: kept
    expect(await screen.findByText('p-job')).toBeInTheDocument();
    expect(asked).toEqual({ p: 1, s: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(onFleet).toHaveBeenCalled();
  });

  it('audit of 314460c #4: every connection answered with no jobs: an empty state, not a bare table', async () => {
    show(() => async () => ok({ jobs: [] }));
    expect(await screen.findByRole('heading', { name: 'No jobs on any connection yet' })).toBeInTheDocument();
  });

  it('JOB-11 slice 2a: status chips (with counts) and Search filter the list across connections', async () => {
    show(
      (c) => async () =>
        ok({
          jobs:
            c.id === 'p'
              ? [row('a1', 'fraud-scoring', 'RESTARTING'), row('a2', 'refund-matcher', 'RUNNING')]
              : [row('b1', 'card-velocity', 'FAILED')],
        }),
    );
    const t = await screen.findByRole('table', { name: 'Jobs on all connections' });
    await vi.waitFor(() => expect(within(t).getAllByRole('row')).toHaveLength(4));
    const names = () =>
      within(screen.getByRole('table', { name: 'Jobs on all connections' }))
        .queryAllByRole('button')
        .map((b) => b.textContent);
    // FAILED is done (Finished, as on the fleet and the Jobs list); RESTARTING is Failing.
    await userEvent.click(screen.getByRole('button', { name: /^Failing 1$/ }));
    expect(names()).toEqual(['fraud-scoring']);
    expect(screen.getByRole('button', { name: /^Failing 1$/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^All 3$/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'card');
    expect(names()).toEqual(['card-velocity']);
  });

  it('audit of 0347582: no chip counts until every connection answered; a filter with no match says so and clears', async () => {
    let release = () => {};
    show((c) => async () => {
      if (c.id === 'p') await new Promise<void>((r) => (release = r)); // prod is slow
      return ok({ jobs: [row(c.id + '1', `${c.id}-job`, c.id === 'p' ? 'RESTARTING' : 'RUNNING')] });
    });
    await screen.findByText('s-job');
    expect(screen.getByRole('button', { name: 'Failing' })).toBeInTheDocument(); // no "Failing 0" while prod reads
    release();
    expect(await screen.findByRole('button', { name: 'Failing 1' })).toBeInTheDocument();
    const box = screen.getByRole('searchbox', { name: 'Search jobs' });
    await userEvent.type(box, 'zzz');
    expect(screen.getByText('No jobs match this search or filter.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(screen.getByText('p-job')).toBeInTheDocument();
  });

  it('audit of 77bfa9f: with a connection down or still reading, no counts and no "no match" (its jobs are missing)', async () => {
    let release = () => {};
    show((c) => async () => {
      if (c.id === 'p') return { status: 503, headers: {}, url: '', body: '' }; // prod is down
      await new Promise<void>((r) => (release = r)); // staging still reading at first
      return ok({ jobs: [row('s1', 's-job', 'RUNNING')] });
    });
    await screen.findByText(/did not answer/);
    await userEvent.click(screen.getByRole('button', { name: 'Failing' }));
    expect(screen.queryByText('No jobs match this search or filter.')).toBeNull(); // staging still reading
    release();
    await screen.findByText(/All connections · 1 job/);
    expect(screen.getByRole('button', { name: 'Failing' })).toBeInTheDocument(); // prod is down: no "Failing 0"
    expect(screen.queryByText('No jobs match this search or filter.')).toBeNull(); // prod's jobs are missing
  });

  it('audit of 96b81e0: one connection answered, another still reading: a filter with no match among the read says nothing yet', async () => {
    let release = () => {};
    show((c) => async () => {
      if (c.id === 'p') await new Promise<void>((r) => (release = r)); // prod still reading (it holds the failing job)
      return ok({ jobs: [row(c.id + '1', `${c.id}-job`, c.id === 'p' ? 'RESTARTING' : 'RUNNING')] });
    });
    await screen.findByText('s-job');
    await userEvent.click(screen.getByRole('button', { name: 'Failing' }));
    expect(screen.queryByText('No jobs match this search or filter.')).toBeNull();
    release();
    expect(await screen.findByText('p-job')).toBeInTheDocument(); // the filter's match was on its way
  });

  it('FLINK_API + §4 per connection: polled every 5 s; failure 1 silent, 2 stale (data age), 3 CONN-LOST over the kept rows; Retry now keeps them; recovery says so once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      let failing = false;
      show((c) => async () => {
        if (c.id === 'p') {
          n++;
          if (failing) throw new TransportError({ kind: 'refused', host: 'p', port: 8081 }); // no contact
        }
        return ok({
          jobs: [
            row(c.id + '1', `${c.id}-job`, 'RUNNING'),
            ...(c.id === 'p' && n > 1 ? [row('p2', 'new-job', 'RUNNING')] : []),
          ],
        });
      });
      await screen.findByText('p-job');
      await vi.advanceTimersByTimeAsync(5_100); // the next round
      expect(await screen.findByText('new-job')).toBeInTheDocument();
      failing = true;
      await vi.advanceTimersByTimeAsync(5_100); // failure 1: silent
      expect(n).toBe(3);
      expect(screen.queryByText(/not answering/)).toBeNull();
      await vi.advanceTimersByTimeAsync(10_100); // failure 2: stale, with the data's age; no banner yet
      expect(n).toBe(4);
      expect(screen.getByText(/payments-prod is not answering\. Showing its data from/)).toBeInTheDocument();
      expect(screen.queryByText(/Lost contact|did not answer/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Running' })).toBeInTheDocument(); // stale: no counts
      await vi.advanceTimersByTimeAsync(20_100); // failure 3: lost contact, over the kept rows
      expect(n).toBe(5);
      expect(await screen.findByText(/^Lost contact with payments-prod\./)).toBeInTheDocument();
      expect(screen.queryByText(/did not answer/)).toBeNull(); // its jobs are not missing: they are shown
      expect(screen.getByText('p-job')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Retry now' }), {
        advanceTimers: vi.advanceTimersByTime,
      });
      await vi.advanceTimersByTimeAsync(100); // its re-read fails again
      expect(n).toBe(6);
      // the countdown is the restarted poller's own (its next poll is in 10 s), not the kept count's 30 s
      expect(screen.getByText(/Retrying every 10 s/)).toBeInTheDocument();
      screen.getByRole('button', { name: 'Retry now' }).focus();
      expect(screen.getByText('p-job')).toBeInTheDocument(); // Retry keeps the rows
      expect(screen.queryByText(/Reading the jobs/)).toBeNull();
      failing = false;
      // Retry restarted its poller, so its back-off starts again (as usePolled's Retry): the next poll is in 10 s.
      await vi.advanceTimersByTimeAsync(10_100); // it answers
      expect(n).toBe(7);
      expect(await screen.findByText('Back in contact with payments-prod.')).toBeInTheDocument();
      expect(screen.queryByText(/Lost contact/)).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus(); // the banner went on its own
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit of 034618d #1: a cluster that answers with an error (503) is not "lost contact": its own message; no "Back in contact"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let failing = false;
      show(
        (c) => async () =>
          c.id === 'p' && failing
            ? { status: 503, headers: {}, url: '', body: '' }
            : ok({ jobs: [row(c.id + '1', `${c.id}-job`, 'RUNNING')] }),
      );
      await screen.findByText('p-job');
      failing = true;
      await vi.advanceTimersByTimeAsync(5_100 + 10_100 + 20_100); // three failures
      await vi.waitFor(() =>
        expect(screen.queryByText(/payments-prod had an internal error/)).not.toBeNull(),
      );
      expect(screen.queryByText(/Lost contact/)).toBeNull();
      expect(screen.getByText('p-job')).toBeInTheDocument();
      failing = false;
      await vi.advanceTimersByTimeAsync(30_100);
      await vi.waitFor(() => expect(screen.queryByText(/had an internal error/)).toBeNull());
      expect(screen.queryByText(/Back in contact/)).toBeNull(); // contact was never lost
    } finally {
      vi.useRealTimers();
    }
  });
});
