import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const app = () =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>,
  );
async function addOne(name: string, token?: string) {
  await userEvent.click(screen.getByRole('button', { name: /Add (a )?connection/ }));
  await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await userEvent.type(screen.getByLabelText(/^Name/), name);
  await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'prod');
  await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'https://10.0.4.12:8081');
  if (token) {
    await userEvent.selectOptions(screen.getByLabelText('Login method'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^Token/), token);
  }
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('CONN-08 the connection list (boards D03, D03d)', () => {
  it('lists the saved connections; Remove asks first; with none left, home is Welcome again', async () => {
    app();
    await addOne('payments-prod', 'S3CRET');
    const table = screen.getByRole('table', { name: 'Connections' });
    const row = within(table).getByRole('row', { name: /payments-prod/ });
    expect(row.textContent).toContain('10.0.4.12:8081');
    expect(row.textContent).toContain('Production');
    expect(row.textContent).toContain('Bearer token');
    await userEvent.click(screen.getByRole('button', { name: 'Remove payments-prod' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove "payments-prod"?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('row', { name: /payments-prod/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove payments-prod' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Stream Lab' })).toBeTruthy();
  });
  it('Export writes the connections file, without the token', async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    app();
    await addOne('payments-prod', 'S3CRET');
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const text = await blobs[0]!.text();
    expect(JSON.parse(text)).toMatchObject({
      format: 'streamlab.connections',
      connections: [{ name: 'payments-prod' }],
    });
    expect(text).not.toContain('S3CRET');
  });
});
