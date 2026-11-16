import { secretKey } from '@sl/flink';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ConnectionForm } from './ConnectionForm';

const form = (onSave = vi.fn(), taken: string[] = []) =>
  render(
    <TooltipProvider>
      <ConnectionForm kind="standalone" taken={taken} onCancel={() => {}} onSave={onSave} />
    </TooltipProvider>,
  );

describe('CONN-02 the connection form (boards D02, D02c)', () => {
  it('a field says its problem on blur, with the catalog words', async () => {
    form();
    await userEvent.click(screen.getByLabelText(/^Name/));
    await userEvent.tab();
    expect(screen.getByText('Name is required.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'flink:8081');
    await userEvent.tab();
    expect(screen.getByText('Enter a full address like https://flink.example.com:8081.')).toBeTruthy();
  });
  it('Save with problems shows every field and CONN-FORM-INVALID with the count; a taken name is refused', async () => {
    const onSave = vi.fn();
    form(onSave, ['payments-prod']);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Payments-Prod');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('A connection called "Payments-Prod" already exists.')).toBeTruthy();
    expect(screen.getByText('Environment is required.')).toBeTruthy();
    expect(await screen.findByText(/Fix 3 field\(s\) to continue\./)).toBeTruthy();
  });
  it('a valid save hands over the connection without the token, and the token for the keychain', async () => {
    const onSave = vi.fn();
    form(onSave);
    await userEvent.type(screen.getByLabelText(/^Name/), 'payments-prod');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'prod');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'https://flink.example.com:8081');
    await userEvent.selectOptions(screen.getByLabelText('Login method'), 'bearer');
    await userEvent.type(screen.getByLabelText(/^Token/), 'S3CRET');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    const { connection, secrets } = onSave.mock.calls[0]![0];
    expect(JSON.stringify(connection)).not.toContain('S3CRET');
    expect(connection).toMatchObject({ name: 'payments-prod', env: 'prod', auth: { type: 'bearer' } });
    expect(secrets).toEqual([{ key: secretKey(connection.id, 'login'), value: 'S3CRET' }]);
  });
});

describe('CONN-01 → CONN-02 the flow', () => {
  it('Welcome → where it runs → the form → saved', async () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    await userEvent.click(screen.getByRole('radio', { name: /Self-managed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 2 of 3 · the connection')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/^Name/), 'dev-local');
    await userEvent.selectOptions(screen.getByLabelText(/^Environment/), 'dev');
    await userEvent.type(screen.getByLabelText(/JobManager REST URL/), 'http://localhost:8081');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved dev-local.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Stream Lab' })).toBeTruthy();
  });
});
