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
});
