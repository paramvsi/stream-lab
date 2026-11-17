import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { clock, ExceptionGroups } from './ExceptionGroups';

const ex = (ts: number, cause: string, task = 'Window aggregate (2/4)') => ({
  exceptionName: 'java.lang.RuntimeException',
  stacktrace: `java.lang.RuntimeException: wrapped\n\tat a\nCaused by: ${cause}\n\tat b`,
  timestamp: ts,
  taskName: task,
});
const T = Date.UTC(2026, 10, 17, 9, 12);
const entries = [
  ex(T + 3 * 60_000, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
  ex(T + 2 * 60_000, 'java.lang.NullPointerException: ScoreFunction.map'),
  ex(T + 60_000, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
  ex(T, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
];

describe('JOB-08 · grouped exceptions (board X20)', () => {
  it('says how many groups and occurrences, and lists groups most frequent first', () => {
    render(<ExceptionGroups entries={entries} />);
    expect(screen.getByText('2 groups, 4 occurrences')).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Exceptions' }))
      .getAllByRole('row')
      .slice(1);
    // audit #6: cell by cell, so a swapped or wrong column fails.
    const cells = within(rows[0]!)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual([
      'TimeoutException · Kafka describeTopics',
      '3',
      clock(T), // first seen
      clock(T + 3 * 60_000), // last seen
    ]);
  });

  it('clock is HH:MM, 24 h', () => {
    expect(clock(T)).toMatch(/^\d{2}:\d{2}$/);
    expect(clock(T)).not.toBe(clock(T + 60_000));
  });

  it('Show N expands to each occurrence (newest first), says it is expanded, and collapses again', async () => {
    render(<ExceptionGroups entries={entries} />);
    const show = screen.getByRole('button', { name: 'Show 3' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(show);
    expect(show).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'TimeoutException occurrences' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(clock(T + 3 * 60_000));
    expect(items[0]).toHaveTextContent('Window aggregate (2/4)');
    await userEvent.click(show);
    expect(screen.queryByRole('list', { name: 'TimeoutException occurrences' })).toBeNull();
  });

  it('audit #1: an open group stays open when a poll re-sorts the groups (keyed by group, not row)', async () => {
    const npe = (ts: number) => ex(ts, 'java.lang.NullPointerException: ScoreFunction.map');
    const first = [...entries, npe(T + 30_000)]; // Timeout 3, NPE 2
    const { rerender } = render(<ExceptionGroups entries={first} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 2' })); // NPE, second row
    rerender(<ExceptionGroups entries={[npe(T + 4 * 60_000), ...first]} />); // NPE 3, newer: now first
    expect(screen.getByRole('list', { name: 'NullPointerException occurrences' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'TimeoutException occurrences' })).toBeNull();
  });

  it('audit #5: when Flink may have dropped older failures, the occurrences say "at least" (N+)', () => {
    render(<ExceptionGroups entries={entries} capped />);
    expect(screen.getByText('2 groups, 4+ occurrences')).toBeInTheDocument();
  });

  it('no exceptions: says so', () => {
    render(<ExceptionGroups entries={[]} />);
    expect(screen.getByRole('heading', { name: 'No exceptions' })).toBeInTheDocument();
  });
});
