import type { Connection } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionForm } from './ConnectionForm';

type Saved = { connection: Connection; secrets: { key: string; value: string }[] };
const form = (test?: Parameters<typeof ConnectionForm>[0]['test']) => {
  const onSave = vi.fn<(r: Saved) => void>();
  render(
    <TooltipProvider>
      <ToastProvider>
        <ConnectionForm
          kind="standalone"
          taken={[]}
          onCancel={() => {}}
          onSave={onSave}
          {...(test ? { test } : {})}
        />
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
    await userEvent.type(screen.getByLabelText('Header 2 name'), 'X-Tenant-Secret');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Header 2 in keychain' }));
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
      { name: 'X-Tenant-Secret', secret: true },
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

describe('audit of 1f108b1', () => {
  const details = () => screen.getByText('Advanced settings').closest('details')!;
  it('#1 #2 a bad header with Advanced closed: Save opens them and goes to the header, which names its error', async () => {
    const onSave = form();
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'Authorization');
    await userEvent.click(screen.getByText('Advanced settings')); // closed again
    expect(details().open).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    const name = screen.getByLabelText('Header 1 name');
    await vi.waitFor(() => expect(document.activeElement).toBe(name));
    expect(details().open).toBe(true);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toMatch(
      /Use the Login section/,
    );
  });
  it('#3 the base path is a path: no address, login, spaces or //; a trailing / is dropped', async () => {
    const onSave = form();
    await basics();
    const bp = screen.getByLabelText('Base path');
    for (const bad of ['flink/payments', 'http://u:p@h/x', '/a b', '/a//b']) {
      await userEvent.clear(bp);
      await userEvent.type(bp, bad);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText(/Enter a base path that starts with \//)).toBeTruthy();
    }
    await userEvent.clear(bp);
    await userEvent.type(bp, '/flink/payments/');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]![0].connection.basePath).toBe('/flink/payments');
  });
  it('#6 #7 #8 a keychain header needs a value; credential names are masked and always kept in the keychain', async () => {
    const onSave = form();
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Api-Key');
    expect(screen.getByLabelText('Header 1 value').getAttribute('type')).toBe('password');
    const box = screen.getByRole('checkbox', { name: 'Header 1 in keychain' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('The value of header "X-Api-Key" is required.')).toBeTruthy();
  });
  it('#5 Test gets the SQL Gateway and proxy secrets only while their addresses are set; #8 one gateway error, Remove keeps focus', async () => {
    const more: unknown[] = [];
    form((_c, _s, m) => {
      more.push(m);
      return async () => {
        throw new Error('stop');
      };
    });
    await basics();
    await userEvent.type(screen.getByLabelText(/SQL Gateway URL/), 'https://gw.example.com');
    await userEvent.selectOptions(screen.getByLabelText('SQL Gateway login'), 'basic');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText('SQL Gateway user is required.')).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText('SQL Gateway login'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^SQL Gateway token/), 'GWT');
    await userEvent.type(screen.getByLabelText(/HTTP proxy/), 'http://proxy:3128');
    await userEvent.type(screen.getByLabelText(/Proxy password/), 'PR0XY');
    await userEvent.clear(screen.getByLabelText(/SQL Gateway URL/));
    await userEvent.clear(screen.getByLabelText(/HTTP proxy/));
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(more).toEqual([{ gateway: '', proxy: '' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove header 2' }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove header 1' })),
    );
  });
});

describe('audit of 3b050a8', () => {
  it('#1 a bad base path blocks Test (a login pasted there never reaches the transport)', async () => {
    const seen: unknown[] = [];
    form((c) => {
      seen.push(c.basePath);
      return async () => {
        throw new Error('stop');
      };
    });
    await basics();
    await userEvent.type(screen.getByLabelText('Base path'), 'https://u:p@h/x');
    expect(screen.getByRole('button', { name: 'Test connection' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(seen).toEqual([]);
  });
  it('#2 a header error marks only its own row and input, and Save goes there', async () => {
    form();
    await basics();
    for (const [n, v] of [
      ['X-Tenant', 'a'],
      ['X-Region', 'b'],
      ['X-Api-Key', ''],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
      const i = screen.getAllByLabelText(/^Header \d+ name$/).length;
      await userEvent.type(screen.getByLabelText(`Header ${i} name`), n);
      if (v) await userEvent.type(screen.getByLabelText(`Header ${i} value`), v);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const value3 = screen.getByLabelText('Header 3 value');
    await vi.waitFor(() => expect(document.activeElement).toBe(value3));
    const invalid = [...document.querySelectorAll('[aria-invalid="true"]')].map((e) =>
      e.getAttribute('aria-label'),
    );
    expect(invalid).toEqual(['Header 3 value']);
  });
  it("#3 a credential header's Keychain box is reachable, says why it is on, and stays on", async () => {
    form();
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Api-Key');
    const box = screen.getByRole('checkbox', { name: 'Header 1 in keychain' }) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toContain(
      'always for X-Api-Key',
    );
    // Seen, not only heard: the reason is not hidden from view.
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.className).not.toMatch(/sr-only/);
    await userEvent.click(box);
    expect(box.checked).toBe(true);
  });
  it('#7 a separate SQL Gateway user missing says "SQL Gateway user is required."', async () => {
    form();
    await basics();
    await userEvent.type(screen.getByLabelText(/SQL Gateway URL/), 'https://gw.example.com');
    await userEvent.selectOptions(screen.getByLabelText('SQL Gateway login'), 'basic');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('SQL Gateway user is required.')).toBeTruthy();
  });
});

describe('audit of 66fa0a5', () => {
  it('base path: nothing invisible, no dot segment, no broken %-escape; "/" saves as none', async () => {
    const onSave = form();
    await basics();
    const bp = screen.getByLabelText('Base path');
    for (const bad of ['/a\u200b', '/a\u202e', '/../admin', '/a/./b', '/%zz']) {
      await userEvent.clear(bp);
      await userEvent.type(bp, bad);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).not.toHaveBeenCalled();
    }
    await userEvent.clear(bp);
    await userEvent.type(bp, '/');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]![0].connection.basePath).toBe('');
  });
  it('a keychain header value of only spaces is empty', async () => {
    const onSave = form();
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Api-Key');
    await userEvent.type(screen.getByLabelText('Header 1 value'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('The value of header "X-Api-Key" is required.')).toBeTruthy();
  });
  it('clicking the always-on Keychain box leaves a finished test result in place', async () => {
    form(() => async () => {
      throw new TypeError('no transport');
    });
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Api-Key');
    await userEvent.type(screen.getByLabelText('Header 1 value'), 'K');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/the test could not run/)).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Header 1 in keychain' }));
    expect(screen.getByText(/the test could not run/)).toBeTruthy();
  });
});
