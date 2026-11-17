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
    expect(rows[0]).toHaveTextContent('TimeoutException');
    expect(rows[0]).toHaveTextContent('Kafka describeTopics');
    expect(rows[0]).toHaveTextContent('3');
    expect(rows[0]).toHaveTextContent(clock(T)); // first seen
    expect(rows[0]).toHaveTextContent(clock(T + 3 * 60_000)); // last seen
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

  it('no exceptions: says so', () => {
    render(<ExceptionGroups entries={[]} />);
    expect(screen.getByRole('heading', { name: 'No exceptions' })).toBeInTheDocument();
  });
});
