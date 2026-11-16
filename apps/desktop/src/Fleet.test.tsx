import { TransportError, type Connection, type FlinkHttp } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Fleet } from './Fleet';

// jsdom drives requestAnimationFrame from its own timer, which a test's fake timers replace and do not give
// back: later tests' banners (filled on the next frame) would never fill. Frames on setTimeout follow the
// timers in use, fake or real.
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const conn = (name: string, env: Connection['env'] = 'prod'): Connection => ({
  id: `c-${name}`,
  name,
  url: `https://${name}.example.com:8081`,
  kind: 'standalone',
  env,
  readOnly: false,
  basePath: '',
  auth: { type: 'none' },
  headers: [],
  transport: { type: 'direct' },
  timeoutMs: 10000,
  pollMs: 5000,
});
const ok = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), url: '' });
const healthy =
  (running: number): FlinkHttp =>
  async (req) =>
    ok(
      req.path === '/config'
        ? { 'flink-version': '2.3.0' }
        : req.path === '/overview'
          ? {
              taskmanagers: 2,
              'slots-total': 32,
              'slots-available': 6,
              'jobs-running': running,
              'jobs-finished': 0,
              'jobs-cancelled': 0,
              'jobs-failed': 0,
            }
          : {
              jobs: [
                ...Array.from({ length: running }, (_, i) => ({
                  jid: `r${i}`,
                  name: `job-${i}`,
                  state: 'RUNNING',
                })),
                { jid: 'a', name: 'fraud-scoring', state: 'RESTARTING' },
              ],
            },
    );
const show = (connections: Connection[], transport: (c: Connection) => FlinkHttp) =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <Fleet connections={connections} transport={transport} onAdd={() => {}} onManage={() => {}} />
      </ToastProvider>
    </TooltipProvider>,
  );
const card = (name: string) => screen.getByRole('listitem', { name });

describe('FLEET-01 the fleet (boards D04, D04b, D04c, D04d)', () => {
  it('loading, then each card: Healthy, running, failing now, slots free, environment and version', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    show([conn('payments-prod'), conn('local-docker', 'dev')], (c) => async (req) => {
      await gate;
      return healthy(c.name === 'payments-prod' ? 13 : 3)(req);
    });
    expect(within(card('payments-prod')).getByText('Loading')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Fleet' }));
    await act(async () => release());
    expect(await within(card('payments-prod')).findByText('Healthy')).toBeTruthy();
    const prod = card('payments-prod').textContent;
    expect(prod).toContain('Running13');
    expect(prod).toContain('Failing1');
    expect(prod).toContain('Slots free6 / 32');
    expect(prod).toContain('Production · Flink 2.3.0');
    expect(await screen.findByText('2 connections · 18 jobs')).toBeTruthy();
  });
  it('an unreachable cluster keeps its card: the catalog message and Retry (D04b)', async () => {
    let down = true;
    show([conn('payments-staging', 'staging')], () => async (req) => {
      if (down)
        throw new TransportError({ kind: 'refused', host: 'payments-staging.example.com', port: 8081 });
      return healthy(9)(req);
    });
    const c = card('payments-staging');
    expect(await within(c).findByText('Unreachable')).toBeTruthy();
    expect(c.textContent).toMatch(/payments-staging\.example\.com/);
    down = false;
    await userEvent.click(within(c).getByRole('button', { name: 'Retry payments-staging' }));
    expect(await within(c).findByText('Healthy')).toBeTruthy();
  });
  it('offline: CONN-OFFLINE over the last data, and nothing is asked (D04d)', async () => {
    const http = vi.fn(healthy(13));
    show([conn('payments-prod')], () => http);
    expect(await within(card('payments-prod')).findByText('Healthy')).toBeTruthy();
    const calls = http.mock.calls.length;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(
      await screen.findByText(/You are offline\. Data is from just now; actions are paused\./),
    ).toBeTruthy();
    expect(within(card('payments-prod')).getByText('Healthy')).toBeTruthy();
    expect(http.mock.calls.length).toBe(calls);
    vi.restoreAllMocks();
  });
});

describe('audit of 23b9f80', () => {
  const refused = new TransportError({ kind: 'refused', host: 'h.example.com', port: 8081 });
  it('#4 one failure keeps the card; two mark it Stale; three show the message, keeping the version and job count', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let fail = false;
      show([conn('payments-staging', 'staging')], () => async (req) => {
        if (fail) throw refused;
        return healthy(9)(req);
      });
      const c = card('payments-staging');
      expect(await within(c).findByText('Healthy')).toBeTruthy();
      fail = true;
      await act(async () => vi.advanceTimersByTime(15_000));
      expect(within(c).getByText('Healthy')).toBeTruthy();
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(within(c).getByText('Stale')).toBeTruthy();
      expect(c.textContent).toContain('Running9');
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(within(c).getByText('Unreachable')).toBeTruthy();
      expect(c.textContent).toContain('Staging · Flink 2.3.0');
      expect(screen.getByText('1 connection · 10 jobs')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
  it('#1 #2 Retry asks only its own cluster, once, and says it is retrying; #11 focus goes to the card after', async () => {
    const asked: string[] = [];
    let downB = true;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    show([conn('a'), conn('b')], (c) => async (req) => {
      asked.push(c.name);
      if (c.name === 'b' && downB) throw refused;
      if (c.name === 'b') await held;
      return healthy(1)(req);
    });
    const b = card('b');
    expect(await within(b).findByText('Unreachable')).toBeTruthy();
    expect(await within(card('a')).findByText('Healthy')).toBeTruthy();
    const before = asked.filter((n) => n === 'a').length;
    downB = false;
    const retry = within(b).getByRole('button', { name: 'Retry b' });
    retry.focus();
    await userEvent.click(retry);
    expect(within(b).getByRole('button', { name: 'Retry b' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(b).getByText('Retrying…')).toBeTruthy();
    await act(async () => release());
    expect(await within(b).findByText('Healthy')).toBeTruthy();
    expect(asked.filter((n) => n === 'a').length).toBe(before);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(within(b).getByRole('heading', { name: 'b' })),
    );
  });
  it('#3 no polling while the window is hidden; #5 a transport that throws is a catalog error, not a crash', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    try {
      const http = vi.fn(healthy(1));
      show([conn('a'), conn('broken')], (c) => {
        if (c.name === 'broken') throw new Error('no transport for this kind');
        return http;
      });
      expect(await within(card('a')).findByText('Healthy')).toBeTruthy();
      expect(within(card('broken')).getByText('Unreachable')).toBeTruthy();
      hidden.mockReturnValue(true);
      const n = http.mock.calls.length;
      await act(async () => vi.advanceTimersByTime(60_000));
      expect(http.mock.calls.length).toBe(n);
    } finally {
      hidden.mockRestore();
      vi.useRealTimers();
    }
  });
  it('#6 a 401 says Signed out, a reply it can not read says Error (not Unreachable); #7 offline with no data says so', async () => {
    show(
      [conn('a'), conn('b')],
      (c) => async () => (c.name === 'a' ? { status: 401, headers: {}, body: '', url: '' } : ok({ nope: 1 })),
    );
    expect(await within(card('a')).findByText('Signed out')).toBeTruthy();
    expect(await within(card('b')).findByText('Error')).toBeTruthy();
  });
  it('#7 opened offline: no "data from never", cards say Offline, nothing is asked', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const http = vi.fn(healthy(1));
      show([conn('a')], () => http);
      expect(within(card('a')).getByText('Offline')).toBeTruthy();
      expect(screen.queryByText(/never/)).toBeNull();
      expect(http).not.toHaveBeenCalled();
    } finally {
      online.mockRestore();
    }
  });
});

describe('audit of ecae65a', () => {
  const refused = new TransportError({ kind: 'refused', host: 'h.example.com', port: 8081 });
  it('#1 a Retry that fails again stays Unreachable (not Healthy), keeps Retry; recovery toasts once; #7 timeout sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let fail = false;
      const timeouts = new Set<number | undefined>();
      show([conn('s')], () => async (req) => {
        timeouts.add(req.timeoutMs);
        if (fail) throw refused;
        return healthy(2)(req);
      });
      const c = card('s');
      expect(await within(c).findByText('Healthy')).toBeTruthy();
      expect([...timeouts]).toEqual([10000]);
      fail = true;
      for (const ms of [15_000, 30_000, 30_000]) await act(async () => vi.advanceTimersByTime(ms));
      expect(within(c).getByText('Unreachable')).toBeTruthy();
      await userEvent.click(within(c).getByRole('button', { name: 'Retry s' }));
      await vi.waitFor(() => expect(within(c).queryByText('Retrying…')).toBeNull());
      expect(within(c).getByText('Unreachable')).toBeTruthy();
      expect(within(c).getByRole('button', { name: 'Retry s' })).toBeTruthy();
      fail = false;
      await userEvent.click(within(c).getByRole('button', { name: 'Retry s' }));
      expect(await within(c).findByText('Healthy')).toBeTruthy();
      expect(await screen.findByText('Back in contact with s.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
  it('#2 the transport-throws message names the address and why', async () => {
    show([conn('broken')], () => {
      throw new Error('no transport for this kind');
    });
    expect(
      await within(card('broken')).findByText(/broken\.example\.com:8081 failed \(no transport\)/),
    ).toBeTruthy();
  });
  it('#3 back from the connection list, the cards keep their data; #4 back in view, it asks at once', async () => {
    const cache = new Map();
    const http = vi.fn(healthy(5));
    const shown = (
      <TooltipProvider>
        <ToastProvider>
          <Fleet
            connections={[conn('a')]}
            transport={() => http}
            onAdd={() => {}}
            onManage={() => {}}
            cache={cache}
          />
        </ToastProvider>
      </TooltipProvider>
    );
    const first = render(shown);
    expect(await within(card('a')).findByText('Healthy')).toBeTruthy();
    first.unmount();
    render(shown);
    expect(within(card('a')).getByText('Healthy')).toBeTruthy();
    expect(screen.getByText('1 connection · 6 jobs')).toBeTruthy();
    await vi.waitFor(() => expect(http.mock.calls.length).toBe(6));
    // A fresh answer: back in view asks nothing; an old one (15 s+): it asks at once.
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(http.mock.calls.length).toBe(6);
    const t = Date.now() + 20_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t);
    try {
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await vi.waitFor(() => expect(http.mock.calls.length).toBe(9));
    } finally {
      clock.mockRestore();
    }
  });
});

describe('audit of 8671a2f', () => {
  const refused = new TransportError({ kind: 'refused', host: 'h.example.com', port: 8081 });
  it('#2 #4 back in view: a failing card keeps its back-off, a hidden event asks nothing', async () => {
    const http = vi.fn(async () => {
      throw refused;
    });
    show([conn('a')], () => http);
    expect(await within(card('a')).findByText('Unreachable')).toBeTruthy();
    const n = http.mock.calls.length;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    hidden.mockRestore();
    expect(http.mock.calls.length).toBe(n);
  });
  it('#3 a failed keyboard Retry does not pull focus to the card when it recovers later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let fail = true;
      show([conn('a')], () => async (req) => {
        if (fail) throw refused;
        return healthy(1)(req);
      });
      const c = card('a');
      expect(await within(c).findByText('Unreachable')).toBeTruthy();
      within(c).getByRole('button', { name: 'Retry a' }).focus();
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => expect(within(c).queryByText('Retrying…')).toBeNull());
      (document.activeElement as HTMLElement).blur();
      fail = false;
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(await within(c).findByText('Healthy')).toBeTruthy();
      expect(document.activeElement).toBe(document.body);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('audit of 7a0933d', () => {
  it('back in view: a card that never answered asks at once; no second ask while a request is still out', async () => {
    let hang = false;
    const http = vi.fn(async (req: Parameters<FlinkHttp>[0]) => {
      if (hang) return new Promise<never>(() => {});
      return healthy(1)(req);
    });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      show([conn('a')], () => http);
      // Mounted hidden: nothing asked, Loading.
      expect(within(card('a')).getByText('Loading')).toBeTruthy();
      expect(http).not.toHaveBeenCalled();
      hidden.mockReturnValue(false);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(await within(card('a')).findByText('Healthy')).toBeTruthy();
      const n = http.mock.calls.length;
      // The answer old: back in view asks (and that request hangs); again: nothing more while it is out.
      hang = true;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000);
      try {
        await act(async () => document.dispatchEvent(new Event('visibilitychange')));
        const asked = http.mock.calls.length;
        expect(asked).toBeGreaterThan(n);
        await act(async () => document.dispatchEvent(new Event('visibilitychange')));
        expect(http.mock.calls.length).toBe(asked);
      } finally {
        clock.mockRestore();
      }
    } finally {
      hidden.mockRestore();
    }
  });
});

describe('CONN-07 what works on this cluster (board C05)', () => {
  const at =
    (version: string): FlinkHttp =>
    async (req) =>
      req.path === '/config' ? ok({ 'flink-version': version }) : healthy(1)(req);
  it('a 1.18 cluster: CONN-VERSION-OLD first, its column marked "This cluster", each cell in words', async () => {
    show([conn('flink-legacy')], () => at('1.18.1'));
    const c = card('flink-legacy');
    await userEvent.click(await within(c).findByRole('button', { name: 'What works' }));
    const dialog = screen.getByRole('dialog', { name: 'flink-legacy · Flink 1.18.1' });
    // The banner fills its live region a moment after the dialog opens (so it is announced).
    expect(
      await within(dialog).findByText(/Flink 1\.18\.1 is older than 1\.20/, {}, { timeout: 3000 }),
    ).toBeTruthy();
    const head = within(dialog).getByRole('columnheader', { name: /Older than 1\.20/ });
    expect(head.textContent).toContain('This cluster');
    const profiler = within(dialog).getByRole('row', { name: /Profiler/ });
    expect(profiler.textContent).toBe('ProfilerNoYesYesYes');
  });
  it('a 2.3 cluster: no warning, the 2.3+ column is this cluster', async () => {
    show([conn('payments-prod')], () => at('2.3.0'));
    await userEvent.click(await within(card('payments-prod')).findByRole('button', { name: 'What works' }));
    const dialog = screen.getByRole('dialog', { name: 'payments-prod · Flink 2.3.0' });
    expect(within(dialog).queryByText(/is older than 1\.20/)).toBeNull();
    expect(within(dialog).getByRole('columnheader', { name: /2\.3\+/ }).textContent).toContain(
      'This cluster',
    );
  });
});
