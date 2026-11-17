import { render, screen, within } from '@testing-library/react';
import { exportConnections, type FlinkHttp } from '@sl/flink';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { App } from './App';

// As main.tsx mounts it: the app uses toasts and tooltips.
const app = () => (
  <TooltipProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </TooltipProvider>
);

describe('INST-02 / CONN-01 first run (boards D01, C01)', () => {
  it('Welcome offers Add a connection and Import connections', () => {
    render(app());
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Stream Lab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a connection' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Import connections/ }).getAttribute('aria-disabled'),
    ).toBeNull();
    expect(screen.getByText('docker compose up gives you Flink on localhost:8081.')).toBeTruthy();
  });
  it('Add a connection asks where the cluster runs first: seven platforms, with their support', async () => {
    render(app());
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    expect(screen.getByRole('heading', { level: 1, name: 'New connection' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 3 · where does it run?')).toBeTruthy();
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(7);
    expect(screen.getAllByText('Full support')).toHaveLength(4);
    expect(screen.getAllByText('Limited')).toHaveLength(2);
    // Nothing chosen yet: Continue says why it can not go on.
    expect(screen.getByRole('button', { name: /Continue/ }).getAttribute('aria-disabled')).toBe('true');
  });
  it('Confluent Cloud says CONN-KIND-UNSUPPORTED inline and can not continue; Back returns to Welcome', async () => {
    render(app());
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Confluent Cloud/ }));
    // The banner fills its live region a moment after it mounts (so it is announced), after a screen-reader prefix.
    expect(
      await screen.findByText(
        /Confluent Cloud for Apache Flink uses a different API\. Not supported in this version\./,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    expect(screen.queryByText(/uses a different API/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Stream Lab' })).toBeTruthy();
  });
});

describe('audit of 45e2672', () => {
  it('#3 an unsupported platform is a calm status (info), naming the platform; #5 each screen starts at its heading', async () => {
    render(app());
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'New connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Confluent Cloud/ }));
    const msg = await screen.findByText(/Confluent Cloud for Apache Flink uses a different API/);
    expect(msg.closest('[role="alert"]')).toBeNull();
    expect(msg.closest('[role="status"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Welcome to Stream Lab' }),
    );
  });
});

describe('FLEET-01 home', () => {
  it('with a transport and a saved connection, home is the fleet; Connections opens the list', async () => {
    const http = async () => ({ status: 503, headers: {}, body: '', url: '' });
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => http} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'local-docker');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeTruthy();
    expect(await screen.findByText(/local-docker had an internal error while reading/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeTruthy();
    // audit of 23b9f80 #8: and back
    await userEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeTruthy();
  });
});

describe('JOB-01 · Open on a fleet card', () => {
  it("opens that cluster's jobs (D07); Fleet goes back", async () => {
    const http: FlinkHttp = async (req) => ({
      status: 200,
      headers: {},
      url: '',
      body: JSON.stringify(
        req.path === '/config'
          ? { 'flink-version': '2.3.0' }
          : req.path === '/overview'
            ? {
                taskmanagers: 1,
                'slots-total': 4,
                'slots-available': 2,
                'jobs-running': 1,
                'jobs-finished': 0,
                'jobs-cancelled': 0,
                'jobs-failed': 0,
              }
            : req.path === '/taskmanagers'
              ? { taskmanagers: [] }
              : req.path === '/jobs/a1/checkpoints'
                ? { counts: { completed: 0, failed: 0, in_progress: 0, restored: 0, total: 1 }, history: [] }
                : req.path === '/jobs/a1'
                  ? {
                      jid: 'a1',
                      name: 'refund-matcher',
                      state: 'RUNNING',
                      'start-time': 1,
                      'end-time': -1,
                      duration: 60_000,
                      now: 60_001,
                      vertices: [],
                    }
                  : {
                      jobs: [
                        {
                          jid: 'a1',
                          name: 'refund-matcher',
                          state: 'RUNNING',
                          'start-time': 1,
                          'end-time': -1,
                          duration: 60_000,
                          'last-modification': 1,
                        },
                      ],
                    },
      ),
    });
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => http} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'local-docker');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open local-docker' }));
    // FLEET-02: Open goes to the cluster (D05); Jobs goes on to the list (D07), Cluster comes back.
    expect(screen.getByRole('heading', { level: 1, name: 'local-docker' })).toHaveFocus();
    await userEvent.click(await screen.findByRole('button', { name: 'Jobs' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    // JOB-02: a row opens that job (D08); Jobs comes back to the list.
    // audit #6: the job name is a button (says it opens something), reached by keyboard.
    await userEvent.click(await screen.findByRole('button', { name: 'refund-matcher' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'refund-matcher' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('heading', { level: 1, name: 'local-docker' })).toBeTruthy();
    // OPS-01: Logs (D18) from the cluster page, and Cluster back (audit of 8e5b27f: no dead end).
    await userEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Logs' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('heading', { level: 1, name: 'local-docker' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeTruthy();
  });
});

describe('audit of 8671a2f', () => {
  it('#1 Import → Replace: the fleet forgets what the old cluster said', async () => {
    const answers: Record<string, unknown> = {
      '/config': { 'flink-version': '2.3.0' },
      '/overview': {
        taskmanagers: 1,
        'slots-total': 4,
        'slots-available': 2,
        'jobs-running': 42,
        'jobs-finished': 0,
        'jobs-cancelled': 0,
        'jobs-failed': 0,
      },
      '/jobs/overview': { jobs: [{ jid: 'a', name: 'x', state: 'RUNNING' }] },
    };
    const transport =
      (c: { url: string }): FlinkHttp =>
      async (req) =>
        c.url.includes('localhost')
          ? { status: 200, headers: {}, body: JSON.stringify(answers[req.path]), url: '' }
          : new Promise(() => {});
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={transport} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'a');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const card = () => screen.getByRole('listitem', { name: 'a' });
    expect(await within(card()).findByText('Healthy')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const file = exportConnections([
      {
        id: 'x',
        name: 'a',
        url: 'https://other.example.com:8081',
        kind: 'standalone',
        env: 'dev',
        readOnly: false,
        basePath: '',
        auth: { type: 'none' },
        headers: [],
        transport: { type: 'direct' },
        timeoutMs: 10000,
        pollMs: 5000,
      },
    ]);
    const dialog = screen.getByRole('dialog', { name: 'Import connections' });
    await userEvent.upload(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      new File([file], 'c.json'),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('a already exists'), 'replace');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(within(card()).getByText('Loading')).toBeTruthy();
    expect(card().textContent).toContain('other.example.com:8081');
    expect(card().textContent).not.toContain('Running');
  });
});

describe('APP-01 · command palette (board G01)', () => {
  const withOne = async () => {
    const http: FlinkHttp = async () => ({ status: 503, headers: {}, body: '', url: '' });
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => http} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'local-docker');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    // ⌘K does nothing on the form: a jump would drop what is typed. (Pressed off any field: jsdom would type the k.)
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeTruthy();
  };

  it('⌘K opens it on the search box; typing filters; Enter jumps (Logs of a cluster), and its heading has focus', async () => {
    await withOne();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    const box = within(dialog).getByRole('combobox', { name: 'Search commands' });
    expect(box).toHaveFocus();
    await userEvent.type(box, 'logs local');
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('Logs · local-docker')]);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Logs' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
  });

  it('Ctrl+K too; ↓ and Enter; Escape closes and focus goes back where it was; no match says so', async () => {
    await withOne();
    const manage = screen.getByRole('button', { name: 'Connections' });
    manage.focus();
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'zzz');
    expect(within(dialog).getByText('No commands match.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
    expect(manage).toHaveFocus();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'local-docker');
    // local-docker (its cluster), Jobs · local-docker, Logs · local-docker: ↓ once is Jobs
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeTruthy();
  });

  it('audit of 37b8316: ⌘K does nothing while another dialog is open (a Stop that is sending, Import, type-to-confirm)', async () => {
    await withOne();
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const importing = screen.getByRole('dialog', { name: 'Import connections' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
    expect(importing.isConnected).toBe(true);
  });
});
