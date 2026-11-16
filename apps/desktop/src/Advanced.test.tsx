import type { Connection } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionForm } from './ConnectionForm';

type Saved = { connection: Connection; secrets: { key: string; value: string }[] };
const form = () => {
  const onSave = vi.fn<(r: Saved) => void>();
  render(
    <TooltipProvider>
      <ToastProvider>
        <ConnectionForm kind="standalone" taken={[]} onCancel={() => {}} onSave={onSave} />
      </ToastProvider>
    </TooltipProvider>,
  );
  return onSave;
};
const basics = async () => {
  await userEvent.type(screen.getByLabelText(/^Name/), 'payments-prod');
  await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'prod');
  await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'https://flink.example.com');
  await userEvent.click(screen.getByText('Advanced settings'));
};

describe('CONN-04 advanced settings (board C02)', () => {
  it('base path, a plain and a keychain header, a proxy with its password, the SQL Gateway with its own token', async () => {
    const onSave = form();
    await basics();
    await userEvent.type(screen.getByLabelText('Base path'), '/flink/payments');
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Tenant');
    await userEvent.type(screen.getByLabelText('Header 1 value'), 'payments');
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 2 name'), 'X-Api-Key');
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Keychain' })[1]!);
    await userEvent.type(screen.getByLabelText('Header 2 value'), 'K3Y');
    await userEvent.type(screen.getByLabelText(/HTTP proxy/), 'http://proxy:3128');
    await userEvent.type(screen.getByLabelText(/Proxy user/), 'ops');
    await userEvent.type(screen.getByLabelText(/Proxy password/), 'PR0XY');
    await userEvent.type(screen.getByLabelText(/SQL Gateway URL/), 'https://flink.example.com/sql');
    await userEvent.selectOptions(screen.getByLabelText('SQL Gateway login'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^SQL Gateway token/), 'GWT');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const { connection: c, secrets } = onSave.mock.calls[0]![0];
    expect(c.basePath).toBe('/flink/payments');
    expect(c.headers).toEqual([
      { name: 'X-Tenant', value: 'payments', secret: false },
      { name: 'X-Api-Key', secret: true },
    ]);
    expect(c.transport).toEqual({ type: 'proxy', url: 'http://proxy:3128', user: 'ops' });
    expect(c.gateway).toEqual({
      url: 'https://flink.example.com/sql',
      sameLogin: false,
      auth: { type: 'bearer' },
    });
    expect(JSON.stringify(c)).not.toMatch(/K3Y|PR0XY|GWT/);
    expect(secrets.map((x) => x.value).sort()).toEqual(['GWT', 'K3Y', 'PR0XY']);
  });
  it('an Authorization header says to use the Login section (CONN-HEADER-AUTH); a separate gateway login needs its token', async () => {
    const onSave = form();
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'Authorization');
    await userEvent.type(screen.getByLabelText(/SQL Gateway URL/), 'https://flink.example.com/sql');
    await userEvent.selectOptions(screen.getByLabelText('SQL Gateway login'), 'bearer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Use the Login section for Authorization/)).toBeTruthy();
    expect(screen.getByText('SQL Gateway token is required.')).toBeTruthy();
  });
});
