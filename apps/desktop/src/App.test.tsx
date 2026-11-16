import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('INST-02 / CONN-01 first run (boards D01, C01)', () => {
  it('Welcome offers Add a connection; Import waits for the connection list and says so', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to Stream Lab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a connection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import connections/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByText('docker compose up gives you Flink on localhost:8081.')).toBeTruthy();
  });
  it('Add a connection asks where the cluster runs first: seven platforms, with their support', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a connection' }));
    expect(screen.getByRole('heading', { level: 1, name: 'New connection' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 3 · where does it run?')).toBeTruthy();
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(7);
    expect(screen.getAllByText('Full support')).toHaveLength(4);
    expect(screen.getAllByText('Limited')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Continue/ }).getAttribute('aria-disabled')).toBe('true');
  });
  it('Confluent Cloud says CONN-KIND-UNSUPPORTED inline and can not continue; Back returns to Welcome', async () => {
    render(<App />);
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
