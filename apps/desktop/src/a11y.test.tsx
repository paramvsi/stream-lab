import type { FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

/**
 * M11 a11y sweep (TESTING.md: axe on every story and route, 0 violations), in jsdom, through the real app against
 * one fake cluster: the screens and overlays listed in the test, each in a loaded state.
 * ponytail: contrast is not checked here (jsdom has no layout), and no real-browser contrast pass of the desktop
 * screens exists yet (only apps/desktop/e2e/connection-form.spec.ts): MORNING. Not covered here: error, offline and
 * empty states, LOG-GONE, the form's validation and Test steps, the Stop dialog's progress and failure steps.
 */
const ok = (body: unknown) => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });
const job = {
  jid: 'a1',
  name: 'refund-matcher',
  state: 'RUNNING',
  'start-time': 1,
  'end-time': -1,
  duration: 60_000,
};
const vertex = {
  id: 'v1',
  name: 'Window aggregate',
  parallelism: 4,
  'start-time': 1,
  'end-time': -1,
  duration: 1,
  status: 'RUNNING',
};
const tm = {
  hardware: { cpuCores: 8, physicalMemory: 16 * 1024 ** 3, freeMemory: 0, managedMemory: 0 },
  id: 'tm1-6d1f0c',
  path: 'pekko.tcp://flink@10.0.4.21:6122/user/rpc/taskmanager_0',
  dataPort: 41_000,
  timeSinceLastHeartbeat: 1,
  slotsNumber: 4,
  freeSlots: 1,
};
const log = [
  '2026-11-17 12:04:01,210 INFO  org.apache.flink.runtime.checkpoint.CheckpointCoordinator [] - Checkpoint 4812 completed',
  '2026-11-17 12:04:05,902 WARN  org.apache.flink.runtime.io.network.buffer.LocalBufferPool [] - Buffer pool usage at 96%',
].join('\n');
const answers: Record<string, unknown> = {
  '/config': { 'flink-version': '2.3.0' },
  '/overview': {
    taskmanagers: 1,
    'slots-total': 4,
    'slots-available': 1,
    'jobs-running': 1,
    'jobs-finished': 0,
    'jobs-cancelled': 0,
    'jobs-failed': 0,
  },
  '/jobs/overview': { jobs: [{ ...job, 'last-modification': 1 }] },
  '/jobs/a1': { ...job, now: 60_001, vertices: [vertex] },
  '/jobs/a1/checkpoints': {
    counts: { completed: 0, failed: 0, in_progress: 0, restored: 0, total: 1 },
    history: [],
  },
  '/jobs/a1/exceptions': { exceptionHistory: { entries: [], truncated: false } },
  '/taskmanagers': { taskmanagers: [tm] },
  '/jobmanager/logs': { logs: [{ name: 'jobmanager.log', size: 200, mtime: 1 }] },
  '/jobmanager/config': [{ key: 'execution.checkpointing.savepoint-dir', value: 's3://payments/savepoints' }],
};
const cluster: FlinkHttp = async (r) => {
  if (r.method !== 'GET') return ok({ 'request-id': 'r1' });
  if (r.path === '/jobmanager/logs/jobmanager.log') return { status: 200, headers: {}, url: '', body: log };
  return ok(answers[r.path] ?? {});
};

const check = async (where: string) => {
  // Live regions fill on the next frame; check them with their content.
  await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  const res = await axe.run(document.body, {
    // jsdom has no layout, so contrast can not be measured (see the note above). Region: as the stories test.
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect({
    where,
    violations: res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  }).toEqual({ where, violations: [] });
};
const gone = (el: HTMLElement) => vi.waitFor(() => expect(el.isConnected).toBe(false));

describe('M11 · A11Y · desktop screens', () => {
  it('the listed screens and overlays, loaded, have 0 axe violations', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const imp = screen.getByRole('dialog', { name: 'Import connections' });
    await check('Import (D03b)');
    await userEvent.keyboard('{Escape}');
    await gone(imp);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const exp = screen.getByRole('dialog', { name: 'Export connections' });
    await check('Export (D03c)');
    await userEvent.keyboard('{Escape}');
    await gone(exp);
    await userEvent.click(screen.getByRole('button', { name: 'Remove payments-prod' }));
    const rm = screen.getByRole('dialog', { name: 'Remove "payments-prod"?' });
    await check('Remove connection (D03d)');
    await userEvent.keyboard('{Escape}');
    await gone(rm);

    await userEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open payments-prod' }));
    const tms = await screen.findByRole('table', { name: 'TaskManagers' });
    await check('Cluster (D05)');
    within(tms).getAllByRole('row')[1]!.focus();
    await userEvent.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'tm1-6d1f0c' });
    await check('TaskManager drawer (D05c)');
    await userEvent.keyboard('{Escape}');
    await gone(drawer);

    await userEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    await screen.findByRole('button', { name: 'refund-matcher' });
    await check('Jobs (D07)');
    await userEvent.click(screen.getByRole('button', { name: 'refund-matcher' }));
    const ops = await screen.findByRole('table', { name: 'Operators' });
    await screen.findByRole('button', { name: 'Stop with savepoint' });
    await check('Job overview (D08)');
    within(ops).getAllByRole('row')[1]!.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 2, name: 'Window aggregate' });
    await check('Operator panel (D09b)');
    for (const [tab, ready] of [
      ['History', 'Timeline'],
      ['Exceptions', 'No exceptions'],
      ['Checkpoints', null],
    ] as const) {
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
      if (ready) await screen.findByRole('heading', { name: ready });
      await check(`Job overview · ${tab}`);
    }
    await userEvent.click(screen.getByRole('tab', { name: /^Overview/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Stop with savepoint' }));
    await screen.findByRole('dialog', { name: /with a savepoint\?/ });
    await check('Stop with savepoint (D15)');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel without a savepoint instead' }));
    const cancel = await screen.findByRole('dialog', { name: 'Cancel refund-matcher on Production?' });
    await check('Cancel on Production, type to confirm (D15e)');
    await userEvent.keyboard('{Escape}');
    await gone(cancel);

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
  }, 60_000);
});
