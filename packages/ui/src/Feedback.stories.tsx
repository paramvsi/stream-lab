import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import { ProblemsPanel, StatusBadge, type Problem } from './StatusBadge';
import { useToast } from './Toast';

/** Boards WX00 / X00: the four severities; banner, toast, badge and panel placements. */
const meta = { title: 'UI/Feedback' } satisfies Meta;
export default meta;
type S = StoryObj<typeof meta>;

export const Banners: S = {
  render: () => (
    <div className="flex w-[720px] flex-col gap-3">
      <Banner severity="error" actions={<Button size="sm">Retry</Button>}>
        payments-prod had an internal error while loading jobs.
      </Banner>
      <Banner severity="warning" actions={<Button size="sm">Retry now</Button>}>
        Lost contact with payments-prod. Retrying every 4 s; showing data from 12 s ago.
      </Banner>
      <Banner severity="info" onDismiss={() => {}}>
        Some features are hidden because this cluster runs Flink 1.20.
      </Banner>
      <Banner severity="success">Back in contact with payments-prod.</Banner>
    </div>
  ),
};

function PushToasts() {
  const toast = useToast();
  useEffect(() => {
    toast({ severity: 'success', message: 'Layout applied', action: { label: 'Undo', onClick: () => {} } });
    toast({ severity: 'warning', message: 'Undo paused the run first.' });
    toast({ severity: 'error', message: 'payments-prod had an internal error while stopping.' });
  }, [toast]);
  return (
    <Button onClick={() => toast({ severity: 'info', message: 'Saved' })}>Show another toast (max 3)</Button>
  );
}

/** Bottom-left, success/info 4 s, warning 6 s, error 8 s, pause on hover, max 3, one action. */
export const Toasts: S = { render: () => <PushToasts /> };

export const Badges: S = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="success">Running</StatusBadge>
      <StatusBadge tone="error">Restarting</StatusBadge>
      <StatusBadge tone="warning">Backpressured</StatusBadge>
      <StatusBadge tone="info">Untested</StatusBadge>
      <StatusBadge tone="neutral">Finished</StatusBadge>
    </div>
  ),
};

const problems: Problem[] = [
  {
    id: '1',
    severity: 'error',
    location: 'Window · Bursts per card',
    message: 'Pick an event-time field on Payments, or switch to processing time.',
    code: 'WIN-NO-TIME',
  },
  {
    id: '2',
    severity: 'warning',
    location: 'Join · Refund match',
    message: 'Unbounded join: state grows forever. Set a time bound.',
    code: 'JOIN-NO-BOUND',
    fix: { label: 'Set bound', apply: () => {} },
  },
  {
    id: '3',
    severity: 'error',
    location: 'Pipeline',
    message: 'Add a Sink so results have somewhere to go.',
    code: 'SIM-NO-SINK',
  },
];

export const Problems: S = {
  render: () => (
    <div className="w-[720px] rounded-lg border border-line">
      <ProblemsPanel problems={problems} filter="all" onFilterChange={() => {}} />
    </div>
  ),
};

export const ProblemsEmpty: S = { render: () => <ProblemsPanel problems={[]} /> };
