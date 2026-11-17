import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JobGraphView } from './JobGraphView';

const node = (id: string, name: string, parallelism = 4, status = 'RUNNING') => ({
  id,
  name,
  parallelism,
  status,
});
const graph = {
  nodes: [
    node('s', 'Source: payments'),
    node('w', 'Window aggregate', 4, 'FAILED'),
    node('k', 'Sink: alerts', 2),
  ],
  edges: [
    { from: 's', to: 'w', ship: 'HASH', num: 0 },
    { from: 'w', to: 'k', ship: null, num: 0 },
  ],
};
/** The card (list item) whose heading is `name`. */
const card = (name: string) => screen.getByRole('heading', { name }).closest('li')!;

describe('JOB-02 · job graph view (board D08)', () => {
  it('operators in flow order, each with its parallelism', () => {
    render(<JobGraphView graph={graph} />);
    expect(
      within(screen.getByRole('list', { name: 'Job graph' }))
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Source: payments', 'Window aggregate', 'Sink: alerts']);
    expect(card('Sink: alerts')).toHaveTextContent('p 2');
  });

  it('each card says, visibly, what it receives from and how (one line per edge)', () => {
    render(<JobGraphView graph={graph} />);
    expect(card('Window aggregate')).toHaveTextContent('from Source: payments · HASH');
  });

  it('audit #3: a strategy Flink did not give is left out, never "FORWARD"', () => {
    render(<JobGraphView graph={graph} />);
    expect(card('Sink: alerts')).toHaveTextContent('from Window aggregate');
    expect(screen.queryByText(/FORWARD/)).toBeNull();
  });

  it('audit #1: two sources feeding different stages: each card names its own inputs (no implied edge)', () => {
    const g = {
      nodes: [
        node('p', 'Source: payments'),
        node('r', 'Source: refunds'),
        node('v', 'Validate'),
        node('j', 'Join'),
      ],
      edges: [
        { from: 'p', to: 'v', ship: 'FORWARD', num: 0 },
        { from: 'v', to: 'j', ship: 'HASH', num: 0 },
        { from: 'r', to: 'j', ship: 'HASH', num: 1 },
      ],
    };
    render(<JobGraphView graph={g} />);
    expect(card('Validate')).toHaveTextContent('from Source: payments · FORWARD');
    expect(card('Validate')).not.toHaveTextContent('refunds');
    expect(card('Join')).toHaveTextContent('from Validate · HASH');
    expect(card('Join')).toHaveTextContent('from Source: refunds · HASH'); // the long edge, said
    // The two sources share the first column, stacked, not side by side with a stage.
    const cols = within(screen.getByRole('list', { name: 'Job graph' })).getAllByRole('list');
    expect(
      cols.map((c) =>
        within(c)
          .getAllByRole('heading')
          .map((h) => h.textContent),
      ),
    ).toEqual([['Source: payments', 'Source: refunds'], ['Validate'], ['Join']]);
  });

  it('a status other than running shows on the operator, in words', () => {
    render(<JobGraphView graph={graph} />);
    expect(within(card('Window aggregate')).getByText('Failed')).toBeInTheDocument();
    expect(within(card('Source: payments')).queryByText('Running')).toBeNull();
  });
});
