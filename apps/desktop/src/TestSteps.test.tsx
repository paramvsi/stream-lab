import { TransportError, type Connection, type FlinkHttp, type FlinkRequest } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const ok = (body: unknown) => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  url: 'http://localhost:8081/x',
});
const answers: Record<string, unknown> = {
  'GET /config': { 'flink-version': '2.3.0', 'refresh-interval': 3000 },
  'GET /overview': {
    taskmanagers: 2,
    'slots-total': 8,
    'slots-available': 3,
    'jobs-running': 4,
    'jobs-finished': 0,
    'jobs-cancelled': 0,
    'jobs-failed': 0,
  },
};
const healthy: FlinkHttp = async (r: FlinkRequest) => {
  const a = answers[`${r.method} ${r.path}`];
  return a ? ok(a) : { status: 404, headers: {}, body: 'not found', url: 'http://localhost:8081/x' };
};
const app = (test?: (c: Connection, secret: string) => FlinkHttp) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <App {...(test ? { test } : {})} />
      </ToastProvider>
    </TooltipProvider>,
  );
const toForm = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
  await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
};
const steps = () => within(screen.getByRole('region', { name: 'Test connection' }));

describe('CONN-05 Test connection in the form (boards D02d, D02e, D02f, C04)', () => {
  it('without a transport it says why; without an address it says to enter one', async () => {
    app();
    await toForm();
    expect(screen.getByRole('button', { name: /Test connection/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
  it('every check in words; a pass says "All checks passed. Ready to save."; the typed token reaches the test', async () => {
    const seen: string[] = [];
    app((c, secret) => {
      seen.push(`${c.url} ${secret}`);
      return healthy;
    });
    await toForm();
    const test = () => screen.getByRole('button', { name: /Test connection|Testing/ });
    expect(test().getAttribute('aria-disabled')).toBe('true'); // no address yet
    await userEvent.type(screen.getByLabelText(/^Name/), 'local-docker');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.selectOptions(screen.getByLabelText('Login method'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^Token/), 'T0K');
    await userEvent.click(test());
    expect(await steps().findByText('All checks passed. Ready to save.')).toBeTruthy();
    expect(seen).toEqual(['http://localhost:8081 T0K']);
    expect(steps().getByText(/Sign in/).textContent).toContain('Passed');
    expect(steps().getAllByRole('listitem')).toHaveLength(7);
  });
  it('a failing check names the step and the catalog message; later checks are Skipped; an edit clears it', async () => {
    app(() => async () => {
      throw new TransportError({ kind: 'refused', host: 'localhost', port: 8081 });
    });
    await toForm();
    await userEvent.type(screen.getByLabelText(/^Name/), 'local-docker');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await steps().findByText(/The test failed:/)).toBeTruthy();
    expect(steps().getAllByText(/· Failed/)).toHaveLength(1);
    expect(steps().getAllByText(/· Skipped/).length).toBeGreaterThan(0);
    expect(steps().getAllByText(/localhost/).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText(/^Name/), 'x');
    expect(screen.queryByRole('region', { name: 'Test connection' })).toBeNull();
  });
});
