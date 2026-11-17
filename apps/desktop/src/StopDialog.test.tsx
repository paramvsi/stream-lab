import type { FlinkHttp, FlinkRequest } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StopDialog } from './StopDialog';

const ok = (status: number, body: unknown) => ({ status, headers: {}, url: '', body: JSON.stringify(body) });

function Harness({ http }: { http: FlinkHttp }) {
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <ToastProvider>
        <button type="button" onClick={() => setOpen(true)}>
          Stop with savepoint
        </button>
        <StopDialog
          open={open}
          onOpenChange={setOpen}
          http={http}
          conn="prod"
          jid="j1"
          job="refund-matcher"
        />
      </ToastProvider>
    </TooltipProvider>
  );
}

describe('ACT-01 · stop with savepoint (D15, D15b, D15c, D15d)', () => {
  it('D15: asks to stop, with the cluster default folder filled in and drain off; Keep running closes and sends nothing', async () => {
    const seen: FlinkRequest[] = [];
    render(
      <Harness
        http={async (r) => (
          seen.push(r),
          ok(200, [{ key: 'execution.checkpointing.savepoint-dir', value: 's3://flink/savepoints/refund/' }])
        )}
      />,
    );
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
    await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
    expect(within(d).getByText(/This cluster has no default savepoint folder/)).toBeInTheDocument();
    expect(seen.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('D15b → D15c: stops once (folder, drain), shows progress, then the saved path with Copy path', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const posts: FlinkRequest[] = [];
      let reads = 0;
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config')
          return ok(200, [{ key: 'state.savepoints.dir', value: 's3://sp' }]);
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
      for (let t = 0; t < 4; t++) await vi.advanceTimersByTimeAsync(1_000);
      const done = await screen.findByRole('dialog', { name: 'refund-matcher stopped' });
      expect(done).toHaveTextContent('s3://sp/savepoint-a71e');
      expect(within(done).getByRole('button', { name: 'Copy path' })).toBeInTheDocument();
      expect(posts).toHaveLength(1);
      expect(posts[0]!.body).toEqual({ targetDirectory: 's3://sp', drain: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('D15d: a failed savepoint says SP-FAILED (the job is still running), with the cause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const http: FlinkHttp = async (r) => {
        if (r.path === '/jobmanager/config')
          return ok(200, [{ key: 'state.savepoints.dir', value: 's3://sp' }]);
        if (r.method === 'POST') return ok(202, { 'request-id': 'r1' });
        return ok(200, {
          status: { id: 'COMPLETED' },
          operation: {
            'failure-cause': {
              class: 'x.CheckpointException',
              'stack-trace': 'x.CheckpointException: Checkpoint expired before completing.',
            },
          },
        });
      };
      render(<Harness http={http} />);
      const d = await screen.findByRole('dialog');
      await within(d).findByDisplayValue('s3://sp');
      await userEvent.click(within(d).getByRole('button', { name: 'Stop with savepoint' }));
      for (let t = 0; t < 3; t++) await vi.advanceTimersByTimeAsync(1_000);
      const f = await screen.findByRole('dialog', { name: 'Savepoint failed' });
      expect(f).toHaveTextContent(
        'Savepoint failed: Checkpoint expired before completing. The job is still running.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stop that is refused says why in the dialog and is not sent again', async () => {
    let posts = 0;
    const http: FlinkHttp = async (r) => {
      if (r.path === '/jobmanager/config')
        return ok(200, [{ key: 'state.savepoints.dir', value: 's3://sp' }]);
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
});
