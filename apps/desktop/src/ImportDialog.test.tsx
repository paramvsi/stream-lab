import { exportConnections, type Connection } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
      'New · Enter its secret after import',
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

describe('audit of 558633c/99e35ff', () => {
  it("#1 a renamed copy never takes a later row's name; #3 focus starts at the list heading after import", async () => {
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Import connections' }));
    await choose(exportConnections([conn('a')]));
    await userEvent.click(screen.getByRole('button', { name: 'Import 1' }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Connections' })),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await choose(exportConnections([conn('a'), conn('a (2)')]));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2' }));
    const rows = within(screen.getByRole('table', { name: 'Connections' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['a', 'a (3)', 'a (2)']);
  });
  it('#2 Cancel clears the preview; #4 a proxy login needs its secret; #5 export switches are all on again', async () => {
    app();
    await userEvent.click(screen.getByRole('button', { name: 'Import connections' }));
    await choose(
      exportConnections([
        conn('p', { transport: { type: 'proxy', url: 'http://proxy:3128', user: 'u' } }),
        conn('q'),
      ]),
    );
    expect(within(screen.getByRole('dialog')).getByRole('row', { name: /^p/ }).textContent).toContain(
      'Enter its secret after import',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import connections' }));
    expect(within(screen.getByRole('dialog')).queryByText('connections.json')).toBeNull();
    await choose(exportConnections([conn('p'), conn('q')]));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('switch', { name: 'p' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect((screen.getByRole('switch', { name: 'p' }) as HTMLInputElement).checked).toBe(true);
  });
});
