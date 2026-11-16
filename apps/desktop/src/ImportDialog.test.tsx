import { exportConnections, type Connection } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const conn = (name: string, over: Partial<Connection> = {}): Connection => ({
  id: `f-${name}`,
  name,
  url: 'https://flink.example.com:8081',
  kind: 'standalone',
  env: 'prod',
  readOnly: false,
  basePath: '',
  auth: { type: 'none' },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: 10000,
  pollMs: 5000,
  ...over,
});
const file = (text: string) => new File([text], 'connections.json', { type: 'application/json' });
const app = () =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>,
  );
const choose = async (text: string) =>
  userEvent.upload(
    within(screen.getByRole('dialog', { name: 'Import connections' })).getByLabelText(/file/i),
    file(text),
  );

describe('CONN-08 import (board D03b)', () => {
  it('from Welcome: lists the file, says which need a secret, imports them', async () => {
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Import connections' }));
    await choose(
      exportConnections([conn('analytics-prod'), conn('payments-staging', { auth: { type: 'bearer' } })]),
    );
    const dialog = screen.getByRole('dialog', { name: 'Import connections' });
    expect(within(dialog).getByText('connections.json')).toBeTruthy();
    expect(within(dialog).getByRole('row', { name: /analytics-prod/ }).textContent).toContain('New');
    expect(within(dialog).getByRole('row', { name: /payments-staging/ }).textContent).toContain(
      'Enter its secret after import',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import 2' }));
    expect(await screen.findByText('Imported 2 connections.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeTruthy();
  });
  it('names that exist: keep both renames, replace keeps the existing one, skip leaves it out (CONN-IMPORT-DUP)', async () => {
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Import connections' }));
    await choose(exportConnections([conn('a'), conn('b'), conn('c')]));
    await userEvent.click(screen.getByRole('button', { name: 'Import 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await choose(
      exportConnections([conn('a', { env: 'dev' }), conn('b', { env: 'dev' }), conn('c', { env: 'dev' })]),
    );
    const dialog = screen.getByRole('dialog', { name: 'Import connections' });
    expect(await within(dialog).findByText(/3 connections already exist/)).toBeTruthy();
    await userEvent.selectOptions(within(dialog).getByLabelText('b already exists'), 'replace');
    await userEvent.selectOptions(within(dialog).getByLabelText('c already exists'), 'skip');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import 2' }));
    const rows = within(screen.getByRole('table', { name: 'Connections' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['a', 'b', 'c', 'a (2)']);
    expect(rows[1]!.textContent).toContain('Dev'); // b replaced
    expect(rows[2]!.textContent).toContain('Production'); // c skipped
  });
  it('a broken file is CONN-IMPORT-INVALID and nothing is imported', async () => {
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Import connections' }));
    await choose('{ "format": "streamlab.connections", oops }');
    const dialog = screen.getByRole('dialog', { name: 'Import connections' });
    expect(
      await within(dialog).findByText(/connections\.json is not a Stream Lab connections file/),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Import' }).getAttribute('aria-disabled')).toBe('true');
  });
});
