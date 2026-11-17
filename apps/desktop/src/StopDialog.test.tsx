import type { FlinkHttp, FlinkRequest } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StopDialog } from './StopDialog';

const ok = (status: number, body: unknown) => ({ status, headers: {}, url: '', body: JSON.stringify(body) });
const cfg = (dir: string) => ok(200, [{ key: 'execution.checkpointing.savepoint-dir', value: dir }]);
const failedSp = ok(200, {
  status: { id: 'COMPLETED' },
  operation: {
    'failure-cause': {
      class: 'x.CheckpointException',
      'stack-trace': 'x.CheckpointException: Checkpoint expired before completing.',
    },
  },
});

function Harness({ http }: { http: FlinkHttp }) {
  const [open, setOpen] = useState(true);
  const h = useRef<HTMLHeadingElement>(null);
  return (
    <TooltipProvider>
      <ToastProvider>
        <h1 ref={h} tabIndex={-1}>
          refund-matcher
        </h1>
        <button type="button" onClick={() => setOpen(true)}>
          Open stop
        </button>
        <StopDialog
          open={open}
          onOpenChange={setOpen}
          http={http}
          conn="prod"
          jid="j1"
          job="refund-matcher"
          fallbackFocus={h}
        />
      </ToastProvider>
    </TooltipProvider>
  );
}

const run = async (fn: () => Promise<void>) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
};
const tick = async (n: number) => {
  for (let t = 0; t < n; t++) await vi.advanceTimersByTimeAsync(1_000);
};

describe('ACT-01 · stop with savepoint (D15, D15b, D15c, D15d)', () => {
  it('D15: asks to stop, with the cluster default folder filled in and drain off; Keep running closes and sends nothing', async () => {
    const seen: FlinkRequest[] = [];
    render(<Harness http={async (r) => (seen.push(r), cfg('s3://flink/savepoints/refund/'))} />);
    const d = await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' });
    expect(await within(d).findByDisplayValue('s3://flink/savepoints/refund/')).toBeInTheDocument();
    expect(within(d).getByRole('checkbox', { name: 'Drain' })).not.toBeChecked();
    await userEvent.click(within(d).getByRole('button', { name: 'Keep running' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(seen.map((r) => r.method)).toEqual(['GET']);
  });

  it('no default and no folder: SP-DIR-MISSING on the field, nothing sent', async () => {
    const seen: FlinkRequest[] = [];
    render(<Harness http={async (r) => (seen.push(r), ok(200, []))} />);
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('textbox', { name: 'Savepoint folder' });
    await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
    expect(within(d).getByText(/This cluster has no default savepoint folder/)).toBeInTheDocument();
    expect(seen.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('audit stop #4: a folder read that fails says so (not "no default folder"); Stop waits while it is read', async () => {
    let answer: (v: ReturnType<typeof ok>) => void = () => {};
    render(<Harness http={() => new Promise((r) => (answer = r))} />);
    const d = await screen.findByRole('dialog');
    expect(within(d).getByRole('button', { name: 'Stop with savepoint' })).toHaveAttribute(
      'aria-disabled',
      'true',
    ); // the kit's Button: aria-disabled, still focusable
    answer({ status: 500, headers: {}, url: '', body: '' });
    expect(await within(d).findByText(/while reading its configuration/)).toBeInTheDocument();
    expect(within(d).queryByText(/This cluster has no default savepoint folder/)).toBeNull();
  });

  it("D15b → D15c: stops once (folder, drain), shows progress, then the board's toast with Copy path; focus is not lost", () =>
    run(async () => {
      const posts: FlinkRequest[] = [];
      let reads = 0;
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return (posts.push(r), ok(202, { 'request-id': 'r1' }));
        reads++;
        return reads < 2
          ? ok(200, { status: { id: 'IN_PROGRESS' } })
          : ok(200, { status: { id: 'COMPLETED' }, operation: { location: 's3://sp/savepoint-a71e' } });
      };
      render(<Harness http={http} />);
      const d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('checkbox', { name: 'Drain' }));
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      expect(await screen.findByRole('dialog', { name: 'Stopping refund-matcher' })).toBeInTheDocument();
      await tick(4);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        await screen.findAllByText('refund-matcher stopped. Savepoint savepoint-a71e saved.'),
      ).not.toHaveLength(0);
      expect(screen.getAllByRole('button', { name: 'Copy path' }).length).toBeGreaterThan(0);
      await tick(1); // the close's focus move
      expect(document.activeElement).not.toBe(document.body);
      expect(posts).toHaveLength(1);
      expect(posts[0]!.body).toEqual({ targetDirectory: 's3://sp', drain: true });
    }));

  it('D15d: SP-FAILED with the cause; Try again goes back to the question; a fresh opening starts there too', () =>
    run(async () => {
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return ok(202, { 'request-id': 'r1' });
        return failedSp;
      };
      render(<Harness http={http} />);
      let d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(3);
      const f = await screen.findByRole('dialog', { name: 'Savepoint failed' });
      expect(f).toHaveTextContent(
        'Savepoint failed: Checkpoint expired before completing. The job is still running.',
      );
      await userEvent.click(within(f).getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' }),
      ).toBeInTheDocument();
      // audit stop #1: fail again, close, reopen: the question, not the old result.
      d = screen.getByRole('dialog');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(3);
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: 'Savepoint failed' })).getByRole('button', {
          name: 'Close',
        }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Open stop' }));
      expect(
        await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' }),
      ).toBeInTheDocument();
    }));

  it('audit stop #2: while the stop is being sent, the dialog cannot be closed; closed while it runs, the result still comes as a toast', () =>
    run(async () => {
      let send: (v: ReturnType<typeof ok>) => void = () => {};
      let reads = 0;
      const http: FlinkHttp = (r) => {
        if (r.path === '/jobmanager/config') return Promise.resolve(cfg('s3://sp'));
        if (r.method === 'POST') return new Promise((res) => (send = res));
        reads++;
        return Promise.resolve(
          reads < 3
            ? ok(200, { status: { id: 'IN_PROGRESS' } })
            : ok(200, { status: { id: 'COMPLETED' }, operation: { location: 's3://sp/savepoint-a71e' } }),
        );
      };
      render(<Harness http={http} />);
      const d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      expect(within(d).getByRole('button', { name: 'Keep running' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ); // the kit's Button: aria-disabled, still focusable
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      send(ok(202, { 'request-id': 'r1' }));
      await screen.findByRole('dialog', { name: 'Stopping refund-matcher' });
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      // Step until it ends (a toast closes by itself after a while: look as soon as it is there).
      for (
        let t = 0;
        t < 12 && !screen.queryAllByText('refund-matcher stopped. Savepoint savepoint-a71e saved.').length;
        t++
      )
        await tick(1);
      expect(
        screen.queryAllByText('refund-matcher stopped. Savepoint savepoint-a71e saved.'),
      ).not.toHaveLength(0);
    }));

  it('a stop that is refused says why in the dialog and is not sent again', async () => {
    let posts = 0;
    const http: FlinkHttp = async (r) => {
      if (r.path === '/jobmanager/config') return cfg('s3://sp');
      posts++;
      return { status: 403, headers: {}, url: '', body: '' };
    };
    render(<Harness http={http} />);
    const d = await screen.findByRole('dialog');
    await within(d).findByDisplayValue('s3://sp');
    await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
    expect(await within(d).findByRole('alert')).toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it('audit stop2 #3: status reads that keep failing stop after 3 and say so (the stop may still finish), not spin forever', () =>
    run(async () => {
      let reads = 0;
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return ok(202, { 'request-id': 'r1' });
        reads++;
        return { status: 404, headers: {}, url: '', body: '' };
      };
      render(<Harness http={http} />);
      const d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(30);
      const r = screen.getByRole('dialog', { name: 'Stopping refund-matcher' });
      expect(within(r).getByRole('alert')).toBeInTheDocument();
      expect(r).toHaveTextContent(/may still finish on the cluster/);
      const at = reads;
      await tick(20);
      expect(reads).toBe(at); // given up: no more reads
      expect(at).toBe(3);
    }));

  it('audit cancel #3 + cancel2: after a stop lost track of its status, a fresh opening says a stop may still be in flight, and locks nothing', () =>
    run(async () => {
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return ok(202, { 'request-id': 'r1' });
        return { status: 404, headers: {}, url: '', body: '' };
      };
      function WithCancel() {
        const [open, setOpen] = useState(true);
        return (
          <TooltipProvider>
            <ToastProvider>
              <button type="button" onClick={() => setOpen(true)}>
                Open stop
              </button>
              <StopDialog
                open={open}
                onOpenChange={setOpen}
                http={http}
                conn="prod"
                jid="j1"
                job="refund-matcher"
                onCancelInstead={() => {}}
              />
            </ToastProvider>
          </TooltipProvider>
        );
      }
      render(<WithCancel />);
      const d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      expect(
        within(d).getByRole('button', { name: 'Cancel without a savepoint instead' }),
      ).toBeInTheDocument();
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(30);
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Open stop' }));
      const again = await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' });
      // audit cancel2: said, not locked (a lock would never clear while the job stays RUNNING).
      expect(again).toHaveTextContent('A stop sent earlier may still be running on the cluster.');
      expect(
        within(again).getByRole('button', { name: 'Cancel without a savepoint instead' }),
      ).toBeInTheDocument();
    }));

  it('audit cancel3: a new stop that is refused keeps the "may still be running" warning (only a completed stop clears it)', () =>
    run(async () => {
      let posts = 0;
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST')
          return ++posts === 1
            ? ok(202, { 'request-id': 'r1' })
            : { status: 500, headers: {}, url: '', body: '' };
        return { status: 404, headers: {}, url: '', body: '' };
      };
      render(<Harness http={http} />);
      let d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(30);
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Open stop' }));
      d = await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' });
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      expect(await within(d).findByRole('alert')).toBeInTheDocument();
      expect(d).toHaveTextContent('A stop sent earlier may still be running on the cluster.');
    }));

  it('audit cancel4: a second stop accepted (202) that then fails keeps the warning (only a completed stop settles the lost one)', () =>
    run(async () => {
      let posts = 0;
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return ok(202, { 'request-id': `r${++posts}` });
        return r.path.endsWith('/r1') ? { status: 404, headers: {}, url: '', body: '' } : failedSp;
      };
      render(<Harness http={http} />);
      let d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(30);
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Open stop' }));
      d = await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' });
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      await tick(3);
      const f = await screen.findByRole('dialog', { name: 'Savepoint failed' });
      await userEvent.click(within(f).getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' }),
      ).toHaveTextContent('A stop sent earlier may still be running on the cluster.');
    }));
});

describe('SP-TIMEOUT (catalog: still IN_PROGRESS after 10 min, board D15b)', () => {
  const slow =
    (posts: FlinkRequest[]): FlinkHttp =>
    async (r) => {
      if (r.path === '/jobmanager/config') return cfg('s3://sp');
      if (r.method === 'POST') return (posts.push(r), ok(202, { 'request-id': 'r1' }));
      return ok(200, { status: { id: 'IN_PROGRESS' } });
    };
  const start = async () => {
    const d = await screen.findByRole('dialog');
    await within(d).findByDisplayValue('s3://sp');
    await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
    return screen.findByRole('dialog', { name: 'Stopping refund-matcher' });
  };

  it('after 10 min still in progress, says so (not before); Keep waiting hides it and the stop goes on', () =>
    run(async () => {
      const posts: FlinkRequest[] = [];
      render(<Harness http={slow(posts)} />);
      await start();
      await vi.advanceTimersByTimeAsync(590_000);
      expect(screen.queryByText(/taking longer than usual/)).toBeNull();
      await vi.advanceTimersByTimeAsync(11_000);
      await vi.waitFor(() =>
        expect(screen.getByRole('dialog', { name: 'Stopping refund-matcher' })).toHaveTextContent(
          /The savepoint is taking longer than usual \(10 min\)\. You can keep waiting or close this; it continues on the cluster\./,
        ),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Keep waiting' }), {
        advanceTimers: vi.advanceTimersByTime,
      });
      expect(screen.queryByText(/taking longer than usual/)).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Stopping refund-matcher' })).toBeInTheDocument();
      expect(posts).toHaveLength(1); // nothing re-sent
    }));

  it('Close closes the dialog; the stop goes on (no second POST)', () =>
    run(async () => {
      const posts: FlinkRequest[] = [];
      render(<Harness http={slow(posts)} />);
      await start();
      await vi.advanceTimersByTimeAsync(601_000);
      await userEvent.click(await screen.findByRole('button', { name: 'Close' }), {
        advanceTimers: vi.advanceTimersByTime,
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(posts).toHaveLength(1);
    }));

  it('audit of 8e70592: the time goes on (closed and reopened, it is the real one); Keep waiting keeps focus in the dialog', () =>
    run(async () => {
      render(<Harness http={slow([])} />);
      await start();
      await userEvent.keyboard('{Escape}', { advanceTimers: vi.advanceTimersByTime }); // closed while it runs
      await vi.advanceTimersByTimeAsync(25 * 60_000);
      await userEvent.click(screen.getByRole('button', { name: 'Open stop' }), {
        advanceTimers: vi.advanceTimersByTime,
      });
      await vi.waitFor(() =>
        expect(screen.getByRole('dialog', { name: 'Stopping refund-matcher' })).toHaveTextContent(
          /taking longer than usual \(25 min\)/,
        ),
      );
      const keep = screen.getByRole('button', { name: 'Keep waiting' });
      keep.focus();
      await userEvent.keyboard('{Enter}', { advanceTimers: vi.advanceTimersByTime });
      expect(screen.queryByText(/taking longer than usual/)).toBeNull();
      expect(screen.getByText(/You can close this; the stop goes on/)).toHaveFocus();
    }));

  it('audit of 779aa1d: the warning does not change every second (a live region would be read again each time)', () =>
    run(async () => {
      render(<Harness http={slow([])} />);
      await start();
      await vi.advanceTimersByTimeAsync(601_000);
      const d = () => screen.getByRole('dialog', { name: 'Stopping refund-matcher' }).textContent;
      await vi.waitFor(() => expect(d()).toMatch(/taking longer than usual/));
      const first = d();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(d()).toBe(first);
    }));

  it('D15b: "Run in background" closes the running dialog; the stop goes on and ends as a toast', () =>
    run(async () => {
      let reads = 0;
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return ok(202, { 'request-id': 'r1' });
        return ++reads < 3
          ? ok(200, { status: { id: 'IN_PROGRESS' } })
          : ok(200, { status: { id: 'COMPLETED' }, operation: { location: 's3://sp/savepoint-a71e' } });
      };
      render(<Harness http={http} />);
      await start();
      await userEvent.click(screen.getByRole('button', { name: 'Run in background' }), {
        advanceTimers: vi.advanceTimersByTime,
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      await tick(4);
      expect(
        await screen.findAllByText('refund-matcher stopped. Savepoint savepoint-a71e saved.'),
      ).not.toHaveLength(0);
    }));
});

describe('the app keeps a sent stop (resume, onSent)', () => {
  it('audit of b389793: a stop whose status is lost is handed back too (it is not followed on at every visit)', () =>
    run(async () => {
      const sent = vi.fn();
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config') return cfg('s3://sp');
        if (r.method === 'POST') return ok(202, { 'request-id': 'r1' });
        return ok(503, {}); // every status read fails
      };
      render(
        <TooltipProvider>
          <ToastProvider>
            <StopDialog
              open
              onOpenChange={() => {}}
              http={http}
              conn="prod"
              jid="j1"
              job="refund-matcher"
              onSent={sent}
            />
          </ToastProvider>
        </TooltipProvider>,
      );
      const d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }), {
        advanceTimers: vi.advanceTimersByTime,
      });
      await vi.waitFor(() => expect(sent).toHaveBeenCalledWith(expect.objectContaining({ rid: 'r1' })));
      await vi.advanceTimersByTimeAsync(15_000); // three failed reads: lost
      await vi.waitFor(() => expect(sent).toHaveBeenLastCalledWith(null));
    }));

  it('audit of b654ec6: a lost stop is reported (onLost), and a dialog opened with lostBefore says "may still be running"', () =>
    run(async () => {
      const lost = vi.fn();
      render(
        <TooltipProvider>
          <ToastProvider>
            <StopDialog
              open
              onOpenChange={() => {}}
              http={async (r) => (r.path === '/jobmanager/config' ? cfg('s3://sp') : ok(200, {}))}
              conn="prod"
              jid="j1"
              job="refund-matcher"
              lostBefore
              onLost={lost}
            />
          </ToastProvider>
        </TooltipProvider>,
      );
      const d = await screen.findByRole('dialog', { name: 'Stop refund-matcher with a savepoint?' });
      expect(
        within(d).getByText('A stop sent earlier may still be running on the cluster.'),
      ).toBeInTheDocument();
    }));
});
