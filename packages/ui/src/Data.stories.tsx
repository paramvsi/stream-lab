import type { Meta, StoryObj } from '@storybook/react-vite';
import { Briefcase, Plug } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Loading, Skeleton } from './Skeleton';
import { StatusBadge } from './StatusBadge';
import { Table, type Column } from './Table';
import { Tabs } from './Tabs';

/** Boards D07 (jobs table), D07c (empty), D07d (loading), D08 (job tabs). */
const meta = { title: 'UI/Data' } satisfies Meta;
export default meta;
type S = StoryObj<typeof meta>;

interface Job {
  id: string;
  name: string;
  status: 'Running' | 'Restarting' | 'Finished';
  uptime: string;
  parallelism: number;
  recordsIn: string;
}
const jobs: Job[] = [
  {
    id: 'a1',
    name: 'fraud-scoring',
    status: 'Restarting',
    uptime: '12 min',
    parallelism: 8,
    recordsIn: '1.2M',
  },
  {
    id: 'b2',
    name: 'card-velocity',
    status: 'Running',
    uptime: '3 d 4 h',
    parallelism: 4,
    recordsIn: '48.1M',
  },
  { id: 'c3', name: 'refund-matching', status: 'Running', uptime: '19 h', parallelism: 2, recordsIn: '310K' },
  { id: 'd4', name: 'merchant-top-n', status: 'Finished', uptime: '—', parallelism: 2, recordsIn: '9.8M' },
];
const tone = { Running: 'success', Restarting: 'error', Finished: 'neutral' } as const;
const columns: Column<Job>[] = [
  { key: 'name', header: 'Job', render: (j) => <b>{j.name}</b> },
  {
    key: 'status',
    header: 'Status',
    render: (j) => <StatusBadge tone={tone[j.status]}>{j.status}</StatusBadge>,
  },
  { key: 'uptime', header: 'Uptime', mono: true, render: (j) => j.uptime },
  { key: 'par', header: 'Parallelism', mono: true, align: 'right', render: (j) => j.parallelism },
  { key: 'in', header: 'Records in', mono: true, align: 'right', render: (j) => j.recordsIn },
];

function JobsTable({ dense }: { dense?: boolean }) {
  const [sel, setSel] = useState<string | null>('a1');
  return (
    <Table
      label="Jobs on payments-prod"
      columns={columns}
      rows={jobs}
      rowKey={(j) => j.id}
      selectedKey={sel}
      onSelect={(j) => setSel(j.id)}
      {...(dense ? { dense } : {})}
    />
  );
}
export const TableDefault: S = { render: () => <JobsTable /> };
export const TableDense: S = { render: () => <JobsTable dense /> };

export const TableLoading: S = {
  render: () => (
    <Loading label="Loading jobs">
      {Array.from({ length: 7 }, (_, i) => (
        <Skeleton key={i} />
      ))}
    </Loading>
  ),
};

export const Empty: S = {
  render: () => (
    <EmptyState
      icon={Briefcase}
      title="No jobs on this cluster yet"
      actions={
        <>
          <Button>Submit JAR</Button>
          <Button variant="primary">Open SQL editor</Button>
        </>
      }
    >
      Submit a JAR, run SQL, or send a pipeline from the simulator.
    </EmptyState>
  ),
};

export const EmptyError: S = {
  render: () => (
    <EmptyState
      icon={Plug}
      severity="error"
      title="Could not reach payments-prod"
      actions={<Button variant="primary">Retry</Button>}
    >
      Nothing is listening on 10.0.4.12:8081. Is the JobManager running and the port right?
    </EmptyState>
  ),
};

export const JobTabs: S = {
  render: () => (
    <Tabs
      label="Job sections"
      items={[
        { value: 'overview', label: 'Overview', content: <p className="m-0">Job graph (M7).</p> },
        { value: 'history', label: 'History', content: <p className="m-0">History.</p> },
        {
          value: 'exceptions',
          label: 'Exceptions',
          count: 0,
          content: <p className="m-0">No exceptions.</p>,
        },
        { value: 'checkpoints', label: 'Checkpoints', content: <p className="m-0">Checkpoints.</p> },
        { value: 'savepoints', label: 'Savepoints', count: 3, content: <p className="m-0">Savepoints.</p> },
      ]}
    />
  ),
};
