import type { FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

/** M11 a11y sweep (TESTING.md: axe on every route, 0 violations), the desktop screens in jsdom. */
const ok = (body: unknown) => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });
const job = {
  jid: 'a1',
  name: 'refund-matcher',
  state: 'RUNNING',
  'start-time': 1,
  'end-time': -1,
  duration: 60_000,
};
const log = [
  '2026-11-17 12:04:01,210 INFO  org.apache.flink.runtime.checkpoint.CheckpointCoordinator [] - Checkpoint 4812 completed',
  '2026-11-17 12:04:05,902 WARN  org.apache.flink.runtime.io.network.buffer.LocalBufferPool [] - Buffer pool usage at 96%',
].join('\n');
const cluster: FlinkHttp = async (r) => {
  if (r.method === 'POST') return ok({ 'request-id': 'r1' });
  if (r.path === '/jobmanager/logs/jobmanager.log') return { status: 200, headers: {}, url: '', body: log };
  const answers: Record<string, unknown> = {
    '/config': { 'flink-version': '2.3.0' },
    '/overview': {
      taskmanagers: 1,
      'slots-total': 4,
      'slots-available': 2,
      'jobs-running': 1,
      'jobs-finished': 0,
      'jobs-cancelled': 0,
      'jobs-failed': 0,
    },
    '/jobs/overview': { jobs: [{ ...job, 'last-modification': 1 }] },
    '/jobs/a1': { ...job, now: 60_001, vertices: [] },
    '/jobs/a1/checkpoints': {
      counts: { completed: 0, failed: 0, in_progress: 0, restored: 0, total: 1 },
      history: [],
    },
    '/taskmanagers': { taskmanagers: [] },
    '/jobmanager/logs': { logs: [{ name: 'jobmanager.log', size: 200, mtime: 1 }] },
    '/jobmanager/config': [
      { key: 'execution.checkpointing.savepoint-dir', value: 's3://payments/savepoints' },
    ],
  };
  return ok(answers[r.path] ?? {});
};

const waitForGone = (el: HTMLElement) => vi.waitFor(() => expect(el.isConnected).toBe(false));
const check = async (where: string) => {
  // Live regions fill on the next frame; check them with their content.
  await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  const res = await axe.run(document.body, {
    // jsdom has no layout: contrast is the real-browser pass (Playwright + axe, M11). Region: screens are <main>.
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect({
    where,
    violations: res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  }).toEqual({ where, violations: [] });
};

describe('M11 · A11Y · desktop screens', () => {
  it('every screen and overlay has 0 axe violations', async () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => cluster} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await check('Welcome (D01)');
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await check('Kind picker (C01)');
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await check('Connection form (D02)');
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-prod');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'prod');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://prod:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    await screen.findByText('Healthy');
    await check('Fleet (D04)');
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }));
    await check('Connections (D03)');
    await userEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open payments-prod' }));
    await screen.findByRole('heading', { level: 1, name: 'payments-prod' });
    await check('Cluster (D05)');
    await userEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    await screen.findByRole('button', { name: 'refund-matcher' });
    await check('Jobs (D07)');
    await userEvent.click(screen.getByRole('button', { name: 'refund-matcher' }));
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    await screen.findByRole('button', { name: 'Stop with savepoint' });
    await check('Job overview (D08)');
    for (const tab of ['History', 'Exceptions', 'Checkpoints']) {
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
      await check(`Job overview · ${tab}`);
    }
    await userEvent.click(screen.getByRole('tab', { name: /^Overview/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop with savepoint' }));
    const stop = await screen.findByRole('dialog', { name: /with a savepoint\?/ });
    await check('Stop with savepoint (D15)');
    await userEvent.keyboard('{Escape}');
    await waitForGone(stop);
    await userEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cluster' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Logs' }));
    await screen.findByRole('table', { name: 'Log lines' });
    await check('Logs (D18)');
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('option', { name: /^refund-matcher/ });
    await check('Command palette (G01)');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('?');
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await check('Keyboard shortcuts (G02)');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Meta>},{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await check('Settings · General (D21)');
    await userEvent.click(screen.getByRole('tab', { name: 'About' }));
    await check('Settings · About (D21)');
  }, 30_000);
});
