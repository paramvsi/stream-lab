import type { Connection, FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Logs } from './Logs';

const conn = {
  id: 'c1',
  name: 'payments-prod',
  url: 'https://payments-prod.example.com:8081',
} as unknown as Connection;
const text = [
  '2026-11-17 12:04:01,210 INFO  org.apache.flink.runtime.checkpoint.CheckpointCoordinator     [] - Checkpoint 4812 completed in 3.4 s (220 MB)',
  '2026-11-17 12:04:05,902 WARN  org.apache.flink.runtime.io.network.buffer.LocalBufferPool    [] - Buffer pool usage at 96% for Window aggregate (1/4)',
  '2026-11-17 12:04:07,250 ERROR org.apache.flink.runtime.taskmanager.Task                    [] - NullPointerException in MerchantLookup.join',
  'java.lang.NullPointerException: merchant is null',
].join('\n');
const ok = (status: number, body: string) => ({ status, headers: {}, url: '', body });
const list = (logs: { name: string; size: number; mtime: number }[]) => ok(200, JSON.stringify({ logs }));

const show = (http: FlinkHttp, onCluster?: () => void) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <Logs c={conn} transport={() => http} {...(onCluster ? { onCluster } : {})} />
      </ToastProvider>
    </TooltipProvider>,
  );

describe('OPS-01 · Logs (D18, D18b)', () => {
  it('D18: the newest JobManager log, its rows as time · level (in words) · message; the stack trace stays with its entry', async () => {
    const asked: string[] = [];
    show(async (r) => {
      asked.push(r.path);
      return r.path === '/jobmanager/logs'
        ? list([
            { name: 'jobmanager.log.1', size: 10, mtime: 1 },
            { name: 'jobmanager.log', size: 18 * 1024 * 1024, mtime: 2 },
          ])
        : ok(200, text);
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Logs' })).toBeInTheDocument();
    const t = await screen.findByRole('table', { name: 'Log lines' });
    const rows = within(t).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('12:04:01.210');
    expect(rows[0]).toHaveTextContent('INFO');
    expect(rows[2]).toHaveTextContent('java.lang.NullPointerException: merchant is null');
    expect(screen.getByText(/jobmanager\.log · 18 MB/)).toBeInTheDocument();
    expect(asked).toEqual(['/jobmanager/logs', '/jobmanager/logs/jobmanager.log']);
  });

  it('D18b: the level filter (All / Warn / Error) and search narrow the rows', async () => {
    show(async (r) =>
      r.path === '/jobmanager/logs' ? list([{ name: 'jobmanager.log', size: 1, mtime: 1 }]) : ok(200, text),
    );
    const t = await screen.findByRole('table', { name: 'Log lines' });
    await userEvent.click(screen.getByRole('radio', { name: 'Warn' }));
    expect(within(t).getAllByRole('row').slice(1)).toHaveLength(2);
    await userEvent.click(screen.getByRole('radio', { name: 'Error' }));
    expect(within(t).getAllByRole('row').slice(1)).toHaveLength(1);
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'buffer');
    const rows = within(t).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Buffer pool usage');
  });

  it(
    'a file over 50 MB says LOG-TOO-LARGE and shows the last 5,000 lines; no logs at all is said, not a blank page',
    { timeout: 20_000 },
    async () => {
      const big = Array.from(
        { length: 6_000 },
        (_, i) => `2026-11-17 12:00:00,000 INFO  x [] - line ${i}`,
      ).join('\n');
      show(async (r) =>
        r.path === '/jobmanager/logs'
          ? list([{ name: 'jobmanager.log', size: 60 * 1024 * 1024, mtime: 1 }])
          : ok(200, big),
      );
      // 5,000 rows render slowly in jsdom (the banner's text lands a frame later): a longer wait.
      expect(
        await screen.findByText(/This log is 60 MB\. Showing the last 5,000 lines\./, {}, { timeout: 8_000 }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('table', { name: 'Log lines' }))
          .getAllByRole('row')
          .slice(1),
      ).toHaveLength(5_000);
    },
  );

  it('no log files: says so', async () => {
    show(async () => list([]));
    expect(await screen.findByText(/No log files/)).toBeInTheDocument();
  });

  it('the file gone between list and read is LOG-GONE (a banner), not a blank page', async () => {
    show(async (r) =>
      r.path === '/jobmanager/logs'
        ? list([{ name: 'jobmanager.log.3', size: 1, mtime: 1 }])
        : ok(404, '{"errors":["gone"]}'),
    );
    expect(await screen.findByText(/jobmanager\.log\.3 is no longer there/)).toBeInTheDocument();
  });

  it(
    "audit logs #3 #4: Cluster goes back; a log file can be picked from the list (LOG-GONE's advice); a cut file says so",
    { timeout: 20_000 },
    async () => {
      const back = vi.fn();
      const lines = Array.from(
        { length: 6_000 },
        (_, i) => `2026-11-17 12:00:00,000 INFO  x [] - line ${i}`,
      ).join('\n');
      const asked: string[] = [];
      show(async (r) => {
        asked.push(r.path);
        return r.path === '/jobmanager/logs'
          ? list([
              { name: 'jobmanager.log', size: 1_000, mtime: 2 },
              { name: 'jobmanager.log.1', size: 10, mtime: 1 },
            ])
          : ok(200, r.path.endsWith('.1') ? 'old' : lines);
      }, back);
      expect(
        await screen.findByText(
          /jobmanager\.log · 1000 B · showing the last 5,000 lines/,
          {},
          { timeout: 8_000 },
        ),
      ).toBeInTheDocument();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Log file' }), 'jobmanager.log.1');
      await screen.findByText('old');
      expect(asked.at(-1)).toBe('/jobmanager/logs/jobmanager.log.1');
      await userEvent.click(screen.getByRole('button', { name: 'Cluster' }));
      expect(back).toHaveBeenCalled();
    },
  );

  it('audit logs2: with one file that rolled over, Reload lists and reads again, and the LOG-GONE banner goes', async () => {
    let reads = 0;
    show(async (r) => {
      if (r.path === '/jobmanager/logs') return list([{ name: 'jobmanager.log', size: 1, mtime: 1 }]);
      return ++reads === 1 ? ok(404, '{"errors":["gone"]}') : ok(200, text);
    });
    expect(await screen.findByText(/jobmanager\.log is no longer there/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Log file' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByRole('table', { name: 'Log lines' })).toBeInTheDocument();
    expect(screen.queryByText(/is no longer there/)).toBeNull();
  });

  it('audit logs3: Reload keeps a picked older file; a list that fails on Reload keeps its banner (no read without a list)', async () => {
    let listing = 0;
    const asked: string[] = [];
    show(async (r) => {
      asked.push(r.path);
      if (r.path === '/jobmanager/logs')
        return ++listing === 3
          ? ok(500, '{"errors":["Internal server error."]}')
          : list([
              { name: 'jobmanager.log', size: 1, mtime: 2 },
              { name: 'jobmanager.log.1', size: 1, mtime: 1 },
            ]);
      return ok(200, r.path.endsWith('.1') ? 'old' : text);
    });
    await screen.findByRole('table', { name: 'Log lines' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Log file' }), 'jobmanager.log.1'); // list 2
    await screen.findByText('old');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' })); // list 3 fails
    expect(await screen.findByText(/had an internal error while listing its logs/)).toBeInTheDocument();
    expect(asked.at(-1)).toBe('/jobmanager/logs'); // nothing read after a failed list
    expect(screen.queryByRole('table', { name: 'Log lines' })).toBeNull(); // no stale rows under a stale header
    await userEvent.click(screen.getByRole('button', { name: 'Reload' })); // list 4 ok: keeps .1
    await screen.findByText('old');
    expect(asked.at(-1)).toBe('/jobmanager/logs/jobmanager.log.1');
  });

  it('audit logs3: no log files still offers Reload', async () => {
    show(async () => list([]));
    await screen.findByText(/No log files/);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('audit logs4: a pick holds while its list loads and when that list fails; Reload then reads the picked file', async () => {
    let listing = 0;
    const asked: string[] = [];
    show(async (r) => {
      asked.push(r.path);
      if (r.path === '/jobmanager/logs')
        return ++listing === 2
          ? ok(500, '{"errors":["Internal server error."]}')
          : list([
              { name: 'jobmanager.log', size: 1, mtime: 2 },
              { name: 'jobmanager.log.1', size: 1, mtime: 1 },
            ]);
      return ok(200, r.path.endsWith('.1') ? 'old' : text);
    });
    await screen.findByRole('table', { name: 'Log lines' });
    const pick = screen.getByRole('combobox', { name: 'Log file' });
    await userEvent.selectOptions(pick, 'jobmanager.log.1'); // its list fails
    expect(await screen.findByText(/had an internal error while listing its logs/)).toBeInTheDocument();
    expect(pick).toHaveValue('jobmanager.log.1');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await screen.findByText('old');
    expect(asked.at(-1)).toBe('/jobmanager/logs/jobmanager.log.1');
  });
});
