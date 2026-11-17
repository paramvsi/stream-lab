import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Jobs, uptime } from './Jobs';

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

  it('M7 performance: a 100-job list renders in under 1 s', async () => {
    const many = Array.from({ length: 100 }, (_, i) => job(`j${i}`, `job-${i}`, 'RUNNING', 60_000));
    const t0 = performance.now();
    show(answer(many));
    await screen.findByRole('row', { name: /job-99/ });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(names()).toHaveLength(100);
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

/** A cluster that answers, then stops answering (refused) while `down` is true. */
function flaky() {
  const st = { down: false, calls: 0 };
  const http: FlinkHttp = async () => {
    st.calls++;
    if (st.down) throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
    return { status: 200, headers: {}, body: JSON.stringify({ jobs: list }), url: '' };
  };
  return { st, http };
}
const tick = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

describe('audit of b5b249a: polling errors (ERRORS_AND_ALERTS §4)', () => {
  it('#4 2 failures mark the rows stale; 3 show CONN-LOST with Retry now; recovery says so once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      await tick(5_000); // 1: silent
      expect(screen.queryByText(/Not answering/)).toBeNull();
      await tick(10_000); // 2: stale
      expect(await screen.findByText(/Not answering\. Showing data from/)).toBeTruthy();
      await tick(20_000); // 3: banner
      expect(await screen.findByText(/Lost contact with payments-prod\. Retrying every \d+ s/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
      expect(screen.getByRole('table', { name: 'Jobs' })).toBeTruthy(); // the rows stay
      f.st.down = false;
      await tick(30_000);
      expect(await screen.findByText('Back in contact with payments-prod.')).toBeTruthy();
      expect(screen.queryByText(/Lost contact/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('#3 a Retry that fails again keeps the banner', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
      await screen.findByText(/Lost contact with payments-prod/);
      const before = f.st.calls;
      await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
      await tick(100);
      expect(f.st.calls).toBe(before + 1); // Retry asked again (audit 2 #6)
      expect(screen.getByText(/Lost contact with payments-prod/)).toBeTruthy();
      // audit 2 #3: the banner names the poller's real wait (a Retry restarts its back-off at 10 s).
      expect(screen.getByText(/Retrying every 10 s/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('#4 a failed first load offers Retry whatever the code (DNS has only Copy details)', async () => {
    let calls = 0;
    show(async () => {
      calls++;
      throw new TransportError({ kind: 'dns', host: 'payments-prod.example.com' });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toBe(2));
  });
});

describe('audit of b5b249a: board and copy', () => {
  it('#5 Restarting is a danger pill, as on D07', async () => {
    show(answer(list));
    const pill = await screen.findByText('Restarting');
    expect(pill.closest('span')?.className).toMatch(/bg-danger-50/);
  });

  it('#6 chips show no counts before the list is read', () => {
    show(async () => new Promise(() => {}));
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /All 0/ })).toBeNull();
  });

  it('#7 a search that matches nothing says so and offers Clear', async () => {
    show(answer(list));
    await screen.findByRole('table', { name: 'Jobs' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'zzz');
    expect(await screen.findByText('No jobs match this search or filter.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(names()).toHaveLength(3);
    // audit 2 #5: focus goes back to the search field, not <body>.
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveFocus();
  });

  it('audit 2 #5: the no-match live region is there, empty, before it says anything', async () => {
    show(answer(list));
    await screen.findByRole('table', { name: 'Jobs' });
    const region = screen.getByTestId('jobs-match');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'zzz');
    expect(region).toHaveTextContent('No jobs match this search or filter.');
  });

  it('#8 uptime never reads "60 min"; sorting by uptime puts finished jobs ("—") at one end', async () => {
    expect(uptime(3_599_999)).toBe('59 min');
    expect(uptime(3_600_000)).toBe('1 h');
    show(answer([...list, job('d4', 'old', 'CANCELED', 9 * 86_400_000)]));
    await screen.findByRole('table', { name: 'Jobs' });
    await userEvent.click(screen.getByRole('button', { name: /^Uptime/ }));
    expect(names()).toEqual(['daily-totals', 'old', 'fraud-scoring', 'refund-matcher']);
  });
});

describe('audit 2 of e31e81c', () => {
  it('#4 no "Back in contact" toast when contact was never lost (first load failed, then answered)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      f.st.down = true;
      show(f.http);
      for (const ms of [0, 10_000, 20_000]) await tick(ms);
      await waitFor(() => expect(f.st.calls).toBe(3));
      f.st.down = false;
      await tick(30_000);
      await screen.findByRole('table', { name: 'Jobs' });
      expect(screen.queryByText(/Back in contact/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('#5 a Retry now that works leaves focus on the heading, not <body>', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
      await screen.findByText(/Lost contact with payments-prod/);
      f.st.down = false;
      await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('audit 3 of 4b4f05f', () => {
  it('#1 a recovery nobody asked for does not move focus to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
      await screen.findByText(/Lost contact with payments-prod/);
      (document.activeElement as HTMLElement | null)?.blur(); // reading the table: focus on <body>
      f.st.down = false;
      await tick(30_000);
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(document.activeElement).toBe(document.body);
    } finally {
      vi.useRealTimers();
    }
  });

  it('#2 the no-match live region exists (empty) before any rows arrive', () => {
    show(async () => new Promise(() => {}));
    expect(screen.getByTestId('jobs-match')).toHaveTextContent('');
  });
});

describe('audit 4 of 31039a3: focus on the banner when it goes', () => {
  const lose = async () => {
    const f = flaky();
    show(f.http);
    await screen.findByRole('table', { name: 'Jobs' });
    f.st.down = true;
    for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
    await screen.findByText(/Lost contact with payments-prod/);
    return f;
  };
  const heading = () => screen.getByRole('heading', { level: 1, name: 'Jobs' });

  it('A: Retry now pressed, fails, then a quiet recovery: focus goes to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = await lose();
      await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
      await tick(100);
      f.st.down = false;
      await tick(30_000);
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(heading()).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('B: on Retry now without pressing it, then a quiet recovery: focus goes to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = await lose();
      screen.getByRole('button', { name: 'Retry now' }).focus();
      f.st.down = false;
      await tick(30_000);
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(heading()).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('C: first load, Retry pressed and failed, then the next poll answers: focus goes to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      f.st.down = true;
      show(f.http);
      await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
      await tick(100);
      f.st.down = false;
      await tick(30_000);
      await screen.findByRole('table', { name: 'Jobs' });
      expect(heading()).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('audit 5 of 04ddce8', () => {
  it('on Retry now, then a click on table text, then a quiet recovery: focus is not moved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
      await screen.findByText(/Lost contact with payments-prod/);
      screen.getByRole('button', { name: 'Retry now' }).focus();
      await userEvent.click(screen.getByText('refund-matcher')); // not focusable: focus goes to <body>
      expect(document.activeElement).toBe(document.body);
      f.st.down = false;
      await tick(30_000);
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(document.activeElement).toBe(document.body);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('audit 6 of c92c91e', () => {
  it('a press that moves no focus (a scrollbar) keeps the banner flag: recovery still goes to the heading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
      await screen.findByText(/Lost contact with payments-prod/);
      const retry = screen.getByRole('button', { name: 'Retry now' });
      retry.focus();
      fireEvent.pointerDown(screen.getByRole('table', { name: 'Jobs' }).parentElement!);
      await tick(10);
      expect(retry).toHaveFocus();
      f.st.down = false;
      await tick(30_000);
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('audit 7 of 0e34d0a', () => {
  it('focus leaves the banner for <body> with no press (a touch tap moves focus after pointerup): not moved on recovery', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = flaky();
      show(f.http);
      await screen.findByRole('table', { name: 'Jobs' });
      f.st.down = true;
      for (const ms of [5_000, 10_000, 20_000]) await tick(ms);
      await screen.findByText(/Lost contact with payments-prod/);
      const retry = screen.getByRole('button', { name: 'Retry now' });
      retry.focus();
      act(() => retry.blur()); // focus to <body>, no pointerdown, no relatedTarget; the banner stays
      await tick(10);
      f.st.down = false;
      await tick(30_000);
      await waitFor(() => expect(screen.queryByText(/Lost contact/)).toBeNull());
      expect(document.activeElement).toBe(document.body);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('audit 8 of 6755d70', () => {
  it('blur to <body> and the recovery in the same task: focus is not moved (no pending-timer race)', async () => {
    vi.useFakeTimers();
    try {
      const st = { down: true, release: null as null | (() => void) };
      const ok = { status: 200, headers: {}, body: JSON.stringify({ jobs: list }), url: '' };
      let first = true;
      const http: FlinkHttp = async () => {
        if (first) {
          first = false;
          return ok;
        }
        if (st.down)
          throw new TransportError({ kind: 'refused', host: 'payments-prod.example.com', port: 8081 });
        return new Promise((res) => (st.release = () => res(ok))); // held: answered by hand
      };
      show(http);
      await act(async () => vi.advanceTimersByTimeAsync(0));
      // Until the 3rd failure shows the banner (filled on the next frame).
      for (let i = 0; i < 10 && !screen.queryByText(/Lost contact/); i++)
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(screen.getByText(/Lost contact with payments-prod/)).toBeTruthy();
      st.down = false;
      await act(async () => vi.advanceTimersByTimeAsync(30_000)); // the next poll is in flight, held
      expect(st.release).not.toBeNull();
      const retry = screen.getByRole('button', { name: 'Retry now' });
      retry.focus();
      await act(async () => {
        retry.blur(); // the user left…
        st.release!(); // …and the good answer lands before any 0 ms timer runs
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      expect(screen.queryByText(/Lost contact/)).toBeNull();
      expect(document.activeElement).toBe(document.body);
    } finally {
      vi.useRealTimers();
    }
  });
});
