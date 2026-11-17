import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Checkpoints } from './Checkpoints';

const cp = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  status,
  is_savepoint: false,
  trigger_timestamp: id * 1000,
  latest_ack_timestamp: id * 1000 + 3400,
  end_to_end_duration: 3400,
  checkpointed_size: 18 * 1024 * 1024,
  num_subtasks: 4,
  num_acknowledged_subtasks: status === 'COMPLETED' ? 4 : 2,
  ...extra,
});
const stats = (
  history: ReturnType<typeof cp>[],
  failed = 0,
  latestFailed: { id: number; failure_message: string } | null = null,
) => ({
  counts: { completed: 4812, failed, in_progress: 0, restored: 0, total: 4812 + failed },
  latest: { completed: cp(4809, 'COMPLETED'), failed: latestFailed },
  history,
});

describe('JOB-12 · Checkpoints tab (boards D12, D12b)', () => {
  it('KPIs and the history table, newest first, status in words, duration and size', () => {
    render(
      <Checkpoints
        stats={stats([cp(4812, 'COMPLETED'), cp(4811, 'COMPLETED')])}
        failedInRow={{ n: 0, more: false }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Completed' })).toHaveTextContent('4,812');
    expect(screen.getByRole('group', { name: 'Failed' })).toHaveTextContent('0');
    const rows = within(screen.getByRole('table', { name: 'Checkpoints' }))
      .getAllByRole('row')
      .slice(1);
    const cells = within(rows[0]!)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual(['4812', 'Completed', '3.4 s', '18 MB']);
  });

  it('D12b: failing in a row says so in red, with JOB-CKPT-FAIL above (id, duration, reason)', async () => {
    render(
      <Checkpoints
        stats={stats(
          [cp(4812, 'FAILED', { end_to_end_duration: 60_000, checkpointed_size: 0 }), cp(4809, 'COMPLETED')],
          3,
          { id: 4812, failure_message: 'Checkpoint expired before completing.' },
        )}
        failedInRow={{ n: 3, more: false }}
      />,
    );
    const failed = screen.getByRole('group', { name: 'Failed' });
    expect(within(failed).getByText('3 in a row').className).toMatch(/text-danger-600/);
    // A warning (catalog): a polite live region, not an alert.
    await waitFor(() =>
      expect(screen.getByText(/^Checkpoint 4812 failed/).closest('[role="status"]')).toHaveTextContent(
        'Checkpoint 4812 failed after 1 min 0 s: Checkpoint expired before completing.', // duration(): never "60.0 s"
      ),
    );
  });

  it('an in-progress checkpoint with no acknowledgement shows "—", not -1 ms', () => {
    render(
      <Checkpoints
        stats={stats([
          cp(4813, 'IN_PROGRESS', {
            end_to_end_duration: -1,
            latest_ack_timestamp: -1,
            checkpointed_size: 0,
          }),
        ])}
        failedInRow={{ n: 0, more: false }}
      />,
    );
    const row = within(screen.getByRole('table', { name: 'Checkpoints' })).getAllByRole('row')[1]!;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['4813', 'In progress', '—', '—']);
  });

  it('checkpointing off: JOB-CKPT-NONE, no table', () => {
    render(<Checkpoints off />);
    expect(
      screen.getByText('Checkpointing is off for this job, so it cannot recover state after a failure.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Checkpoints' })).toBeNull();
  });
});
