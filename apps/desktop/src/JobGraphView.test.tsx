import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JobGraphView } from './JobGraphView';

const graph = {
  nodes: [
    { id: 's', name: 'Source: payments', parallelism: 4, status: 'RUNNING' },
    { id: 'w', name: 'Window aggregate', parallelism: 4, status: 'FAILED' },
    { id: 'k', name: 'Sink: alerts', parallelism: 2, status: 'RUNNING' },
  ],
  edges: [
    { from: 's', to: 'w', ship: 'HASH', num: 0 },
    { from: 'w', to: 'k', ship: 'FORWARD', num: 0 },
  ],
};

describe('JOB-02 · job graph view (board D08)', () => {
  it('operators in flow order, each with its parallelism', () => {
    render(<JobGraphView graph={graph} />);
    const items = within(screen.getByRole('list', { name: 'Job graph' })).getAllByRole('listitem');
    expect(items.map((i) => within(i).getByRole('heading').textContent)).toEqual([
      'Source: payments',
      'Window aggregate',
      'Sink: alerts',
    ]);
    expect(items[2]).toHaveTextContent('p 2');
  });

  it('says in words what each operator receives from, and how (screen readers get the edges too)', () => {
    render(<JobGraphView graph={graph} />);
    const w = screen.getByRole('listitem', { name: /Window aggregate/ });
    expect(w).toHaveTextContent('from Source: payments (HASH)');
  });

  it('the ship strategy shows between the columns, as on D08', () => {
    render(<JobGraphView graph={graph} />);
    expect(screen.getAllByText('HASH').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FORWARD').length).toBeGreaterThan(0);
  });

  it('a status other than running shows on the operator, in words', () => {
    render(<JobGraphView graph={graph} />);
    expect(
      within(screen.getByRole('listitem', { name: /Window aggregate/ })).getByText('Failed'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem', { name: /Source: payments/ })).queryByText('Running'),
    ).toBeNull();
  });
});
