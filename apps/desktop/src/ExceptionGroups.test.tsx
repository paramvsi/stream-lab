import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@sl/ui';
import { describe, expect, it, vi } from 'vitest';
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
    const list = screen.getByRole('list', { name: 'Occurrences: TimeoutException · Kafka describeTopics' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(clock(T + 3 * 60_000));
    expect(items[0]).toHaveTextContent('Window aggregate (2/4)');
    await userEvent.click(show);
    expect(
      screen.queryByRole('list', { name: 'Occurrences: TimeoutException · Kafka describeTopics' }),
    ).toBeNull();
  });

  it('audit #1: an open group stays open when a poll re-sorts the groups (keyed by group, not row)', async () => {
    const npe = (ts: number) => ex(ts, 'java.lang.NullPointerException: ScoreFunction.map');
    const first = [...entries, npe(T + 30_000)]; // Timeout 3, NPE 2
    const { rerender } = render(<ExceptionGroups entries={first} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 2' })); // NPE, second row
    rerender(<ExceptionGroups entries={[npe(T + 4 * 60_000), ...first]} />); // NPE 3, newer: now first
    expect(
      screen.getByRole('list', { name: 'Occurrences: NullPointerException · ScoreFunction.map' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'Occurrences: TimeoutException · Kafka describeTopics' }),
    ).toBeNull();
  });

  it('audit #5: when Flink may have dropped older failures, the occurrences say "at least" (N+)', () => {
    render(<ExceptionGroups entries={entries} capped />);
    expect(screen.getByText('2 groups, 4+ occurrences')).toBeInTheDocument();
  });

  it('no exceptions: says so', () => {
    render(<ExceptionGroups entries={[]} />);
    expect(screen.getByRole('heading', { name: 'No exceptions' })).toBeInTheDocument();
  });

  it('D11b: an open group shows its newest full stack trace, line by line, with Copy (says copied, or COPY-FAILED)', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    // The newest occurrence's trace differs (a frame of its own), with Java's trailing line end and a Suppressed
    // block, written with Windows line ends: so "newest", the line split and the nesting are all checked.
    const newest = {
      ...entries[0]!,
      stacktrace:
        'java.lang.RuntimeException: wrapped\r\n\tat newest\r\n\tSuppressed: java.io.IOException: close\r\n\t\tat c\r\n\tCaused by: java.net.SocketException: reset\r\nCaused by: java.util.concurrent.TimeoutException: Kafka describeTopics\r\n\t... 14 more\r\n',
    };
    render(
      <ToastProvider>
        <ExceptionGroups entries={[newest, ...entries.slice(1)]} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show 1' }));
    // Two groups open: each trace, list and Copy is named for its group.
    const trace = screen.getByRole('list', {
      name: 'Newest stack trace: TimeoutException · Kafka describeTopics',
    });
    expect(
      screen.getByRole('list', { name: 'Newest stack trace: NullPointerException · ScoreFunction.map' }),
    ).toBeInTheDocument();
    const items = within(trace).getAllByRole('listitem');
    expect(items.map((l) => l.textContent)).toEqual([
      'java.lang.RuntimeException: wrapped',
      'at newest',
      'Suppressed: java.io.IOException: close',
      'at c',
      'Caused by: java.net.SocketException: reset',
      'Caused by: java.util.concurrent.TimeoutException: Kafka describeTopics',
      '... 14 more',
    ]);
    // Nesting kept: the Suppressed block's own cause sits deeper than the real one.
    const depth = (li: HTMLElement) => Number(li.dataset.depth);
    expect(depth(items[4]!)).toBeGreaterThan(depth(items[5]!));
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy stack trace (TimeoutException · Kafka describeTopics)' }),
    );
    expect(writeText).toHaveBeenCalledWith(newest.stacktrace);
    expect(await screen.findByText('Stack trace copied')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy stack trace (TimeoutException · Kafka describeTopics)' }),
    );
    expect(await screen.findByText(/Could not copy to the clipboard/)).toBeInTheDocument();
  });

  it('audit d11b #2: two groups of one exception type, both open, are still told apart by name', async () => {
    render(
      <ExceptionGroups
        entries={[
          ex(T + 60_000, 'java.util.concurrent.TimeoutException: Kafka describeTopics'),
          ex(T, 'java.util.concurrent.TimeoutException: Heartbeat of TaskManager timed out'),
        ]}
      />,
    );
    for (const b of screen.getAllByRole('button', { name: 'Show 1' })) await userEvent.click(b);
    expect(
      screen.getByRole('button', { name: 'Copy stack trace (TimeoutException · Kafka describeTopics)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Copy stack trace \(TimeoutException · Heartbeat/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('region', { name: /^Stack trace: / }).map((r) => r.getAttribute('aria-label')),
    ).toHaveLength(2);
    expect(
      new Set(
        screen.getAllByRole('region', { name: /^Stack trace: / }).map((r) => r.getAttribute('aria-label')),
      ).size,
    ).toBe(2);
  });

  it('audit d11b #3: a very long message is cut in names (role word first), never the whole line on every stop', async () => {
    const long =
      "java.lang.ClassCastException: class com.acme.Payment cannot be cast to class com.acme.Payment (com.acme.Payment is in unnamed module of loader org.apache.flink.util.ChildFirstClassLoader @5a2e4553; com.acme.Payment is in unnamed module of loader 'app')";
    render(<ExceptionGroups entries={[ex(T, long)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 1' }));
    const copy = screen.getByRole('button', { name: /^Copy stack trace \(ClassCastException · / });
    const region = screen.getByRole('region', { name: /^Stack trace: ClassCastException · / });
    for (const el of [copy, region]) expect(el.getAttribute('aria-label')!.length).toBeLessThanOrEqual(110);
    expect(region.getAttribute('aria-label')).toMatch(/…$/);
  });
});
