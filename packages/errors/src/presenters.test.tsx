import { Field, Input, ToastProvider } from '@sl/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './core';
import { ErrorBanner, ErrorDialog, FieldError } from './presenters';

afterEach(() => vi.unstubAllGlobals());

describe('ERR · presenters', () => {
  it('CONN-URL-INVALID FieldError wires into Field: described, no nested <p>', () => {
    render(
      <Field label="JobManager REST URL" error={<FieldError error={new AppError('CONN-URL-INVALID')} />}>
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('JobManager REST URL')).toHaveAccessibleDescription(
      'Enter a full address like https://flink.example.com:8081.',
    );
    expect(document.querySelectorAll('p p')).toHaveLength(0);
  });

  it('Copy details confirms with a toast when the clipboard works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(
      <ToastProvider>
        <ErrorBanner error={new AppError('API-SHAPE')} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(await screen.findAllByText('Details copied')).not.toHaveLength(0);
  });

  it('COPY-FAILED toast when the clipboard rejects', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(
      <ToastProvider>
        <ErrorBanner error={new AppError('API-SHAPE')} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(
      await screen.findAllByText('Could not copy to the clipboard. Your browser blocked it.'),
    ).not.toHaveLength(0);
  });

  it('COPY-FAILED toast when there is no clipboard API (insecure context)', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    render(
      <ToastProvider>
        <ErrorBanner error={new AppError('API-SHAPE')} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(
      await screen.findAllByText('Could not copy to the clipboard. Your browser blocked it.'),
    ).not.toHaveLength(0);
  });

  it('API-409 dialog: choosing an action closes it, even without onAction', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <ErrorDialog
          open={open}
          onOpenChange={setOpen}
          error={new AppError('API-409', { job: 'fraud-scoring', state: 'stopping' })}
        />
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
