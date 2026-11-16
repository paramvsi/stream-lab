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
  it('Export (board D03c): choose which connections; Save file writes them, nothing secret, revoked later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const blobs: Blob[] = [];
    const names: string[] = [];
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    try {
      app();
      await addOne('payments-prod', 'S3CRET');
      await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));
      await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await userEvent.type(screen.getByLabelText(/^Name/), 'local-docker');
      await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
      await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await userEvent.click(screen.getByRole('button', { name: 'Export' }));
      const dialog = screen.getByRole('dialog', { name: 'Export connections' });
      expect(within(dialog).getByText(/Tokens, passwords and keys are never exported\./)).toBeTruthy();
      await userEvent.click(within(dialog).getByRole('switch', { name: 'local-docker' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save file' }));
      expect(names).toEqual(['streamlab-connections.json']);
      const text = await blobs[0]!.text();
      expect(JSON.parse(text).connections.map((c: { name: string }) => c.name)).toEqual(['payments-prod']);
      expect(text).not.toContain('S3CRET');
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally {
      click.mockRestore();
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      vi.useRealTimers();
    }
  });
  it("after Remove, focus goes to the next row's Remove (not the page)", async () => {
    app();
    await addOne('a');
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'b');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove a' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove b' })),
    );
  });
});
