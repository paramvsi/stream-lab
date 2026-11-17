import type { FlinkHttp, FlinkRequest } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CancelDialog } from './CancelDialog';

function Harness({ http, prod = true }: { http: FlinkHttp; prod?: boolean }) {
  const [open, setOpen] = useState(true);
  const h = useRef<HTMLHeadingElement>(null);
  return (
    <TooltipProvider>
      <ToastProvider>
        <h1 ref={h} tabIndex={-1}>
          refund-matcher
        </h1>
        <CancelDialog
          open={open}
          onOpenChange={setOpen}
          http={http}
          conn="payments-prod"
          jid="j1"
          job="refund-matcher"
          prod={prod}
          fallbackFocus={h}
        />
      </ToastProvider>
    </TooltipProvider>
  );
}

const reply = (status: number, body: unknown = {}) => ({
  status,
  headers: {},
  url: '',
  body: JSON.stringify(body),
});

describe('ACT-02 · cancel (D15e)', () => {
  it('D15e on prod: names the cost, needs the job name typed exactly before Cancel job does anything', async () => {
    const seen: FlinkRequest[] = [];
    render(<Harness http={async (r) => (seen.push(r), reply(202))} />);
    const d = await screen.findByRole('dialog', { name: 'Cancel refund-matcher on Production?' });
    expect(d).toHaveTextContent(
      'Cancel stops the job without a savepoint. State since the last checkpoint is lost.',
    );
    const go = within(d).getByRole('button', { name: 'Cancel job' });
    expect(go).toHaveAttribute('aria-disabled', 'true');
    const box = within(d).getByRole('textbox', { name: 'Type the job name to confirm' });
    await userEvent.type(box, 'refund-matc');
    await userEvent.click(go);
    expect(seen).toHaveLength(0);
    await userEvent.type(box, 'her');
    expect(go).not.toHaveAttribute('aria-disabled');
    await userEvent.click(go);
    expect(seen).toEqual([
      expect.objectContaining({ method: 'PATCH', path: '/jobs/j1', query: { mode: 'cancel' } }),
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findAllByText('refund-matcher cancelled.')).not.toHaveLength(0);
  });

  it('not prod: no typing, Cancel job is ready', async () => {
    render(<Harness http={async () => reply(202)} prod={false} />);
    const d = await screen.findByRole('dialog', { name: 'Cancel refund-matcher?' });
    expect(within(d).queryByRole('textbox')).toBeNull();
    expect(within(d).getByRole('button', { name: 'Cancel job' })).not.toHaveAttribute('aria-disabled');
  });

  it('a job that already ended (409) says so in the dialog, once, not sent again', async () => {
    let n = 0;
    render(
      <Harness
        prod={false}
        http={async () => (
          n++,
          reply(409, {
            errors: [
              'Job cancellation failed because the job has already reached another terminal state (FINISHED).',
            ],
          })
        )}
      />,
    );
    const d = await screen.findByRole('dialog');
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel job' }));
    expect(await within(d).findByText(/refund-matcher is already finished/)).toBeInTheDocument();
    expect(n).toBe(1);
  });
});
