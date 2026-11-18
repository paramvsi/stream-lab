import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppError } from '@sl/errors';
import { exportConnections, type FlinkHttp } from '@sl/flink';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  const withOne = async (
    http: FlinkHttp = async () => ({ status: 503, headers: {}, body: '', url: '' }),
    /** Per connection (a request carries only its path). */
    byConn?: (c: { url: string }) => FlinkHttp,
  ) => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={byConn ?? (() => http)} />
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

  it('G02: "?" (not while typing) and the palette open the shortcuts sheet, listing only keys that work; Escape returns focus', async () => {
    await withOne();
    const manage = screen.getByRole('button', { name: 'Connections' });
    manage.focus();
    await userEvent.keyboard('?');
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(
      within(sheet)
        .getAllByRole('rowheader')
        .map((r) => r.textContent),
    ).toEqual(['⌘K', '⌘1–9', 'G J', 'G L', '⌘,', '?']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    expect(manage).toHaveFocus();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'shortcuts');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  });

  it('G02: "?" in a text field types a "?"', async () => {
    await withOne();
    // a field outside any dialog (the palette's own dialog would block "?" anyway): the Logs search box
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'logs local');
    await userEvent.keyboard('{Enter}');
    const box = await screen.findByRole('searchbox', { name: 'Search logs' });
    await userEvent.type(box, '?');
    expect(box).toHaveValue('?');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('audit of 5559d61: the sheet has the board\'s "Done", which closes it and gives focus back', async () => {
    await withOne();
    const manage = screen.getByRole('button', { name: 'Connections' });
    manage.focus();
    await userEvent.keyboard('?');
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    expect(manage).toHaveFocus();
  });

  it("G02 keys: ⌘1–9 switch connection; G J and G L go to the open connection's jobs and logs; the sheet lists them", async () => {
    await withOne();
    // a second connection, through the palette
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'add connection');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-staging');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'staging');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://staging:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}2{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: 'payments-staging' })).toHaveFocus();
    await userEvent.keyboard('gj');
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    await userEvent.keyboard('gl');
    expect(await screen.findByRole('heading', { level: 1, name: 'Logs' })).toHaveFocus();
    // in a field, g and l are letters
    const box = screen.getByRole('searchbox', { name: 'Search logs' });
    await userEvent.type(box, 'gj');
    expect(box).toHaveValue('gj');
    expect(screen.getByRole('heading', { level: 1, name: 'Logs' })).toBeTruthy();
    box.blur();
    await userEvent.keyboard('{Control>}1{/Control}');
    expect(await screen.findByRole('heading', { level: 1, name: 'local-docker' })).toBeTruthy();
    await userEvent.keyboard('?');
    expect(
      within(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }))
        .getAllByRole('rowheader')
        .map((r) => r.textContent),
    ).toEqual(['⌘K', '⌘1–9', 'G J', 'G L', '⌘,', '?']);
  });

  it('audit of 7cee880: the keys work by physical key too (AZERTY ⌘ + "1/&" gives "&"; G J on an Arabic layout)', async () => {
    await withOne();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: '&', code: 'Digit1', metaKey: true }); // AZERTY
    expect(await screen.findByRole('heading', { level: 1, name: 'local-docker' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ل', code: 'KeyG' }); // Arabic layout
    fireEvent.keyDown(document.body, { key: 'ت', code: 'KeyJ' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ن', code: 'KeyK', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();
  });

  it('audit of ef86fcc: a Latin layout goes by its labels (Dvorak ⌘ + "t" on the physical K is not ⌘K)', async () => {
    await withOne();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 't', code: 'KeyK', metaKey: true }); // Dvorak ⌘T
    expect(screen.queryByRole('dialog', { name: 'Commands' })).toBeNull();
    // On a cluster (G J needs an open connection), Dvorak's i then h is not G J.
    fireEvent.keyDown(document.body, { key: '1', code: 'Digit1', metaKey: true });
    await screen.findByRole('heading', { level: 1, name: 'local-docker' });
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'i', code: 'KeyG' });
    fireEvent.keyDown(document.body, { key: 'h', code: 'KeyJ' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { level: 1, name: 'local-docker' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Jobs' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyV', metaKey: true }); // Dvorak's labelled K
    expect(screen.getByRole('dialog', { name: 'Commands' })).toBeInTheDocument();
  });

  it('G01 jobs: the palette lists every cluster\'s jobs ("Job · cluster"); Enter opens the job', async () => {
    const http: FlinkHttp = async (req) => ({
      status: 200,
      headers: {},
      url: '',
      body: JSON.stringify(
        req.path === '/jobs/overview'
          ? {
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
                {
                  jid: 'b2',
                  name: 'fraud-scoring',
                  state: 'RESTARTING',
                  'start-time': 1,
                  'end-time': -1,
                  duration: 60_000,
                  'last-modification': 1,
                },
              ],
            }
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
            : req.path === '/jobs/a1/checkpoints'
              ? { counts: { completed: 0, failed: 0, in_progress: 0, restored: 0, total: 1 }, history: [] }
              : {},
      ),
    });
    await withOne(http);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'refund');
    const opt = await within(dialog).findByRole('option', { name: /^refund-matcher/ });
    expect(opt).toHaveTextContent('Job · local-docker');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'refund-matcher' })).toBeTruthy();
  });

  it('G01 jobs: a cluster whose jobs can not be read is said in the palette (catalog), and navigation still works', async () => {
    await withOne(); // every request 503
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    expect(await within(dialog).findByText(/local-docker .*reading the jobs/)).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: /Logs · local-docker/ })).toBeInTheDocument();
  });

  const row = (jid: string, name: string, state: string) => ({
    jid,
    name,
    state,
    'start-time': 1,
    'end-time': -1,
    duration: 60_000,
    'last-modification': 1,
  });
  const ok = (body: unknown) => ({ status: 200, headers: {}, url: '', body: JSON.stringify(body) });
  const addSecond = async () => {
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'add connection');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-staging');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'staging');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://staging:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    (document.activeElement as HTMLElement).blur();
  };

  it("audit of df70949 #1: the palette's reads share the per-connection limiter (never more than 6 in flight)", async () => {
    let inFlight = 0;
    let most = 0;
    const http: FlinkHttp = () => {
      most = Math.max(most, ++inFlight);
      return new Promise(() => {}); // a cluster that never answers
    };
    await withOne(http);
    for (let i = 0; i < 7; i++) {
      await userEvent.keyboard('{Meta>}k{/Meta}');
      await userEvent.keyboard('{Escape}');
    }
    expect(most).toBeLessThanOrEqual(6);
  });

  it('audit of df70949 #2: the highlighted command stays the same when jobs arrive above it', async () => {
    const held: (() => void)[] = []; // the fleet's reads are held too
    const release = () => held.splice(0).forEach((f) => f());
    const byConn =
      (c: { url: string }): FlinkHttp =>
      async (r) => {
        if (r.path !== '/jobs/overview') return { status: 503, headers: {}, body: '', url: '' };
        if (c.url.includes('localhost')) {
          await new Promise<void>((res) => held.push(res));
          return ok({ jobs: [row('a1', 'refund-matcher', 'RUNNING')] });
        }
        return ok({ jobs: [] });
      };
    await withOne(undefined, byConn);
    await addSecond();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    const box = within(dialog).getByRole('combobox');
    for (let i = 0; i < 9; i++) await userEvent.keyboard('{ArrowDown}'); // to payments-staging
    const at = () => document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(at()).toMatch(/^payments-staging/);
    release();
    await within(dialog).findByRole('option', { name: /^refund-matcher/ });
    expect(at()).toMatch(/^payments-staging/);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'payments-staging' })).toBeTruthy();
  });

  it('audit of df70949 #3–5: notes name their cluster (also an unreadable reply), in a mounted live region; same-name runs show their state', async () => {
    const byConn =
      (c: { url: string }): FlinkHttp =>
      async (r) =>
        r.path !== '/jobs/overview'
          ? { status: 503, headers: {}, body: '', url: '' }
          : c.url.includes('localhost')
            ? { status: 200, headers: {}, url: '', body: '<html>Sign in</html>' } // a proxy's page
            : ok({ jobs: [row('o', 'refund-matcher', 'FINISHED'), row('n', 'refund-matcher', 'RUNNING')] });
    await withOne(undefined, byConn);
    await addSecond();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    const notes = within(dialog).getByRole('list', { name: 'Palette notes' });
    expect(notes).toHaveAttribute('aria-live', 'polite');
    expect(notes).toHaveAttribute('aria-atomic', 'false');
    expect(await within(notes).findByText(/^local-docker: /)).toBeInTheDocument();
    const runs = await within(dialog).findAllByRole('option', { name: /^refund-matcher/ });
    expect(runs.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Running'),
      expect.stringContaining('Finished'),
    ]);
  });

  it('audit of f673f5c: closing and reopening the palette never piles up reads; a screen can still get a slot', async () => {
    let inFlight = 0;
    let most = 0;
    const http: FlinkHttp = () => {
      most = Math.max(most, ++inFlight);
      return new Promise(() => {}); // a cluster that never answers
    };
    await withOne(http);
    for (let i = 0; i < 7; i++) {
      await userEvent.keyboard('{Meta>}k{/Meta}');
      await userEvent.keyboard('{Escape}');
    }
    // the fleet card's 3 (config, overview, jobs) and one palette read, reused across opens: 2 of 6 still free
    expect(most).toBe(4);
  });

  it('audit of f4ccb1a: after Import → Replace (same id, another cluster), the palette reads the new cluster', async () => {
    const byConn =
      (c: { url: string }): FlinkHttp =>
      (r) =>
        c.url.includes('localhost')
          ? new Promise(() => {}) // the old cluster: its palette read stays in flight
          : r.path === '/jobs/overview'
            ? Promise.resolve(ok({ jobs: [row('y1', 'chargeback-router', 'RUNNING')] }))
            : Promise.resolve({ status: 503, headers: {}, body: '', url: '' });
    await withOne(undefined, byConn);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const file = exportConnections([
      {
        id: 'x',
        name: 'local-docker',
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
    await userEvent.selectOptions(within(dialog).getByLabelText('local-docker already exists'), 'replace');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import 1' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import connections' })).toBeNull());
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const palette = screen.getByRole('dialog', { name: 'Commands' });
    expect(await within(palette).findByRole('option', { name: /^chargeback-router/ })).toBeInTheDocument();
  });

  const jobHttp =
    (posts: string[]): FlinkHttp =>
    async (req) => {
      if (req.method === 'POST') {
        posts.push(req.path);
        return ok({ 'request-id': 'r1' });
      }
      return ok(
        req.path === '/jobs/overview'
          ? { jobs: [row('a1', 'refund-matcher', 'RUNNING'), row('f9', 'old-batch', 'FINISHED')] }
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
            : req.path === '/jobs/a1/checkpoints'
              ? { counts: { completed: 0, failed: 0, in_progress: 0, restored: 0, total: 1 }, history: [] }
              : req.path === '/jobmanager/config'
                ? [{ key: 'execution.checkpointing.savepoint-dir', value: 's3://payments/savepoints' }]
                : req.path.startsWith('/jobs/a1/savepoints/')
                  ? { status: { id: 'IN_PROGRESS' } }
                  : {},
      );
    };

  it('G01 actions: "Stop with savepoint: {job}" opens the job with its Stop dialog (confirm first); only running jobs offer it', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'stop');
    const opts = await within(dialog).findAllByRole('option', { name: /Stop with savepoint/ });
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Stop with savepoint: refund-matcher'),
    ]);
    await userEvent.keyboard('{Enter}');
    expect(
      await screen.findByRole('dialog', { name: /Stop refund-matcher|Stop with savepoint/ }),
    ).toBeInTheDocument();
    expect(posts).toEqual([]); // nothing sent before the dialog's own confirm
  });

  it('G01 actions: "Trigger savepoint: {job}" opens the job and sends its one trigger', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'trigger refund');
    await within(dialog).findByRole('option', { name: /Trigger savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    await vi.waitFor(() => expect(posts).toEqual(['/jobs/a1/savepoints']));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts).toEqual(['/jobs/a1/savepoints']); // once
  });

  it('G01 actions: a read-only connection offers no actions (its jobs still jump)', async () => {
    const posts: string[] = [];
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => jobHttp(posts)} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-prod');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'prod');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://prod:8081');
    await userEvent.click(screen.getByRole('switch', { name: /Read-only connection/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Commands' });
    await userEvent.type(within(dialog).getByRole('combobox'), 'refund');
    await within(dialog).findByRole('option', { name: /^refund-matcher/ });
    expect(within(dialog).queryByRole('option', { name: /savepoint/ })).toBeNull();
  });

  it('audit of c3add40 #1: an action the page can not do on its first read is dropped (no savepoint minutes later)', async () => {
    const posts: string[] = [];
    let reads = 0;
    const base = jobHttp(posts);
    const http: FlinkHttp = async (req) => {
      if (req.path === '/jobs/a1') {
        // restarting when the page reads it, running again a poll later
        const state = ++reads === 1 ? 'RESTARTING' : 'RUNNING';
        return ok({
          jid: 'a1',
          name: 'refund-matcher',
          state,
          'start-time': 1,
          'end-time': -1,
          duration: 60_000,
          now: 60_001,
          vertices: [],
        });
      }
      return base(req);
    };
    await withOne(http);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'trigger refund');
    await screen.findByRole('option', { name: /Trigger savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2), { timeout: 5_000 }); // it is running again
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toEqual([]);
  }, 10_000);

  it("audit of c3add40 #2: on that job's page already, the palette action still runs", async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'refund');
    await screen.findByRole('option', { name: /^refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    await screen.findByRole('button', { name: 'Trigger savepoint' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'trigger refund');
    await screen.findByRole('option', { name: /Trigger savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(posts).toEqual(['/jobs/a1/savepoints']));
  });

  it('audit of 2899731: a pick whose first job read fails is dropped (no savepoint when the cluster answers later)', async () => {
    const posts: string[] = [];
    let reads = 0;
    const base = jobHttp(posts);
    const http: FlinkHttp = async (req) => {
      if (req.path === '/jobs/a1')
        return ++reads === 1
          ? { status: 503, headers: {}, body: '', url: '' } // the first read fails
          : ok({
              jid: 'a1',
              name: 'refund-matcher',
              state: 'RUNNING',
              'start-time': 1,
              'end-time': -1,
              duration: 60_000,
              now: 60_001,
              vertices: [],
            });
      return base(req);
    };
    await withOne(http);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'trigger refund');
    await screen.findByRole('option', { name: /Trigger savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2), { timeout: 8_000 }); // the cluster answers again
    await screen.findByRole('button', { name: 'Trigger savepoint' });
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toEqual([]);
  }, 15_000);

  it('audit of 52e8ca2: Back from Settings to a job page does not run the palette action again (one savepoint POST)', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'trigger refund');
    await screen.findByRole('option', { name: /Trigger savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(posts).toEqual(['/jobs/a1/savepoints']));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>},{/Meta}');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    await screen.findByRole('button', { name: /Trigger savepoint/ });
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toEqual(['/jobs/a1/savepoints']);
  });

  it('JOB-11: "Jobs · all connections" lists every connection\'s jobs; a job opens on its connection', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'all connections');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    const t = await screen.findByRole('table', { name: 'Jobs on all connections' });
    await userEvent.click(await within(t).findByRole('button', { name: 'refund-matcher' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'refund-matcher' })).toBeTruthy();
  });

  it('whole-app audit #1: a stop run in the background is still known after leaving the page and coming back (no second stop)', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'refund');
    await screen.findByRole('option', { name: /^refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop with savepoint' }));
    const confirm = await screen.findByRole('dialog', { name: /with a savepoint\?/ });
    await within(confirm).findByDisplayValue('s3://payments/savepoints');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Stop with savepoint' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run in background' }));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>},{/Meta}'); // leave the page
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    // the stop is still running: Trigger savepoint says why it is off, and Stop shows its progress, not the question
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Trigger savepoint' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Stop with savepoint' }));
    expect(await screen.findByRole('dialog', { name: 'Stopping refund-matcher' })).toBeInTheDocument();
    expect(posts.filter((p) => p.endsWith('/stop'))).toHaveLength(1);
  });

  it('whole-app audit #2 #3: each screen names the window; G L works from a radio (a letter is not typed there)', async () => {
    await withOne();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'all connections');
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('table', { name: 'Jobs on all connections' });
    expect(document.title).toBe('Jobs · all connections · Stream Lab');
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>},{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(document.title).toBe('Settings · Stream Lab');
    await userEvent.keyboard('{Meta>}1{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'local-docker' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('gl');
    await screen.findByRole('heading', { level: 1, name: 'Logs' });
    expect(document.title).toBe('Logs · local-docker · Stream Lab');
    screen.getByRole('radio', { name: 'Error' }).focus(); // a level radio has focus
    await userEvent.keyboard('gj');
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeTruthy();
  });

  it('audit of b654ec6: after a lost stop, leaving and coming back still says a stop may still be running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const base = jobHttp([]);
      const http: FlinkHttp = (r) =>
        r.path.startsWith('/jobs/a1/savepoints/')
          ? Promise.resolve({ status: 503, headers: {}, url: '', body: '' })
          : base(r);
      await withOne(http);
      await u.keyboard('{Meta>}k{/Meta}');
      await u.type(screen.getByRole('combobox', { name: 'Search commands' }), 'refund');
      await screen.findByRole('option', { name: /^refund-matcher/ });
      await u.keyboard('{Enter}');
      await u.click(await screen.findByRole('button', { name: 'Stop with savepoint' }));
      const confirm = await screen.findByRole('dialog', { name: /with a savepoint\?/ });
      await within(confirm).findByDisplayValue('s3://payments/savepoints');
      await u.click(within(confirm).getByRole('button', { name: 'Stop with savepoint' }));
      await vi.advanceTimersByTimeAsync(15_000); // three failed status reads: lost
      await screen.findByText(/stopped asking for its progress/);
      await u.keyboard('{Escape}');
      (document.activeElement as HTMLElement).blur();
      await u.keyboard('{Meta>},{/Meta}');
      await u.click(await screen.findByRole('button', { name: 'Back' }));
      await u.click(await screen.findByRole('button', { name: 'Stop with savepoint' }));
      const again = await screen.findByRole('dialog', { name: /with a savepoint\?/ });
      expect(
        within(again).getByText('A stop sent earlier may still be running on the cluster.'),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit of bc26026 M1: a palette "Trigger savepoint" on a job whose stop runs in the background sends nothing', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'refund');
    await screen.findByRole('option', { name: /^refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop with savepoint' }));
    const confirm = await screen.findByRole('dialog', { name: /with a savepoint\?/ });
    await within(confirm).findByDisplayValue('s3://payments/savepoints');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Stop with savepoint' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run in background' }));
    await userEvent.click(screen.getByRole('button', { name: 'Jobs' })); // leave the page
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'trigger refund');
    await screen.findByRole('option', { name: /Trigger savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'refund-matcher' });
    await new Promise((r) => setTimeout(r, 300));
    expect(posts.filter((p) => p.endsWith('/savepoints'))).toEqual([]); // only the stop, never a trigger meanwhile
  });

  it('audit of ca74bd0 #1: a palette "Stop with savepoint" on a job whose stop runs in the background opens its progress', async () => {
    const posts: string[] = [];
    await withOne(jobHttp(posts));
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'refund');
    await screen.findByRole('option', { name: /^refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop with savepoint' }));
    const confirm = await screen.findByRole('dialog', { name: /with a savepoint\?/ });
    await within(confirm).findByDisplayValue('s3://payments/savepoints');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Stop with savepoint' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run in background' }));
    await userEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'stop with refund');
    await screen.findByRole('option', { name: /Stop with savepoint: refund-matcher/ });
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Stopping refund-matcher' })).toBeInTheDocument();
    expect(posts.filter((p) => p.endsWith('/stop'))).toHaveLength(1);
  });

  it("whole-app audit LOW: G L on Settings opened from a cluster goes to that cluster's logs", async () => {
    await withOne();
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}1{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'local-docker' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>},{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('gl');
    expect(await screen.findByRole('heading', { level: 1, name: 'Logs' })).toBeTruthy();
  });
});

describe('APP-04 · Settings (boards D21)', () => {
  it('⌘, opens Settings; the default refresh interval is what a new connection starts with; Light only; About', async () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => async () => ({ status: 503, headers: {}, body: '', url: '' })} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.keyboard('{Meta>},{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAccessibleDescription(
      'Dark theme coming in v1',
    );
    await userEvent.selectOptions(screen.getByLabelText('Default refresh interval'), '15000');
    await userEvent.click(screen.getByRole('tab', { name: 'About' }));
    expect(
      screen.getByText(/Apache Flink and Flink are trademarks of the Apache Software Foundation/),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.type(screen.getByRole('combobox', { name: 'Search commands' }), 'add connection');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText('Refresh every')).toHaveValue('15000');
  });

  it('audit of b0c592e: Back returns to the screen Settings was opened from', async () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <App transport={() => async () => ({ status: 503, headers: {}, body: '', url: '' })} />
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
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>}1{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'local-docker' });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Meta>},{/Meta}');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'local-docker' })).toBeTruthy();
  });
});

describe('CONN-03 / CONN-KEYCHAIN: saving a connection puts its secret in the keychain', () => {
  const fill = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-prod');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'https://pay:8081');
    await userEvent.selectOptions(screen.getByLabelText('Login method'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^Token/), 's3cret');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  };
  const withKeep = (keep: (conn: string, s: { key: string; value: string }[]) => Promise<void>) => (
    <TooltipProvider>
      <ToastProvider>
        <App keep={keep} />
      </ToastProvider>
    </TooltipProvider>
  );
  it('the token goes to keep(), never into the saved connection', async () => {
    const keep = vi.fn().mockResolvedValue(undefined);
    render(withKeep(keep));
    await fill();
    await screen.findByRole('heading', { level: 1, name: 'Connections' });
    expect(keep).toHaveBeenCalledWith('payments-prod', [
      { key: expect.stringMatching(/\/login$/), value: 's3cret' },
    ]);
  });
  it('a refused keychain shows CONN-KEYCHAIN over the form, which keeps what was typed; Try again saves', async () => {
    const keep = vi
      .fn()
      .mockRejectedValueOnce(new AppError('CONN-KEYCHAIN', { conn: 'payments-prod' }))
      .mockResolvedValueOnce(undefined);
    render(withKeep(keep));
    await fill();
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain(
      'Stream Lab could not read the saved secret for payments-prod from the keychain',
    );
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('payments-prod');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: 'Connections' });
    expect(keep).toHaveBeenCalledTimes(2);
  });
});

describe('audit of ccb989d #7', () => {
  it('Try again twice while the keychain is busy saves the connection once', async () => {
    let finish: () => void = () => {};
    const keep = vi
      .fn()
      .mockRejectedValueOnce(new AppError('CONN-KEYCHAIN', { conn: 'payments-prod' }))
      .mockImplementation(() => new Promise<void>((r) => (finish = r)));
    render(
      <TooltipProvider>
        <ToastProvider>
          <App keep={keep} />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-prod');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'https://pay:8081');
    await userEvent.selectOptions(screen.getByLabelText('Login method'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^Token/), 's3cret');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dlg = await screen.findByRole('dialog');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Try again' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Try again' }));
    finish();
    await screen.findByRole('heading', { level: 1, name: 'Connections' });
    expect(keep).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('payments-prod')).toHaveLength(1);
  });
});

describe('APP-STORE-FAILED / saved connections (CONN-08 kept on this computer)', () => {
  const pay = {
    id: 'p1',
    name: 'payments-prod',
    url: 'https://pay:8081',
    kind: 'standalone',
    env: 'prod',
    readOnly: false,
    basePath: '',
    auth: { type: 'none' },
    headers: [],
    transport: { type: 'direct' },
    timeoutMs: 10_000,
    pollMs: 5_000,
  } as const;
  const withSaved = (saved: { load: () => Promise<unknown[]>; save: (cs: unknown[]) => Promise<void> }) => (
    <TooltipProvider>
      <ToastProvider>
        <App saved={saved as never} />
      </ToastProvider>
    </TooltipProvider>
  );
  it('the saved connections are there at start; a change is saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(withSaved({ load: async () => [pay], save }));
    expect(await screen.findByText('payments-prod')).toBeTruthy();
    expect(screen.getByText('Saved on this computer')).toBeTruthy();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith([pay]));
  });
  it('a read that fails says so, never writes over the file, and Try again reads again', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new AppError('APP-STORE-FAILED', { what: 'read' }))
      .mockResolvedValueOnce([pay]);
    const save = vi.fn().mockResolvedValue(undefined);
    render(withSaved({ load, save }));
    expect(
      await screen.findByText(/Stream Lab could not read your connections on this computer/),
    ).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('payments-prod')).toBeTruthy();
    expect(screen.queryByText(/could not read your connections/)).toBeNull();
  });
  it('a save that fails says so; Try again saves again and clears it', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new AppError('APP-STORE-FAILED', { what: 'save' }))
      .mockResolvedValue(undefined);
    render(withSaved({ load: async () => [pay], save }));
    expect(
      await screen.findByText(/Stream Lab could not save your connections on this computer/),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByText(/could not save your connections/)).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
  });
});
