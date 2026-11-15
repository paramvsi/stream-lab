import { Button, Field, Input, ProblemsPanel, StatusBadge } from '@sl/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Unplug } from 'lucide-react';
import { useState } from 'react';
import { AppError, present } from './core';
import { ErrorBanner, ErrorDialog, ErrorPage, toProblems, useErrorToast } from './presenters';

/** Boards X00 (desktop) and WX00 (web): four severities × seven placements, all through present(). */
const meta = { title: 'Errors/System (X00, WX00)' } satisfies Meta;
export default meta;
type S = StoryObj<typeof meta>;

/** One real catalog code per severity. */
export const Severities: S = {
  render: () => (
    <div className="flex w-[760px] flex-col gap-3">
      <ErrorBanner error={new AppError('API-5XX', { conn: 'payments-prod', verb: 'loading jobs' })} />
      <ErrorBanner error={new AppError('CONN-LOST', { conn: 'payments-prod', s: 4, ago: '12 s ago' })} />
      <ErrorBanner error={new AppError('CONN-FEATURE-VERSION', { version: '1.20' })} onDismiss={() => {}} />
      <ErrorBanner error={new AppError('SQL-TRUNCATED', { n: '10,000' })} />
    </div>
  ),
};

export const PlacementField: S = {
  render: () => (
    <div className="w-[480px]">
      <Field label="JobManager REST URL" error={present(new AppError('CONN-URL-INVALID')).message}>
        <Input mono defaultValue="10.0.4.12:8081" />
      </Field>
    </div>
  ),
};

export const PlacementBadge: S = {
  render: () => (
    <div className="inline-flex items-center gap-3 rounded-lg border-2 border-danger-600 px-4 py-3">
      <b>Bursts per card</b>
      <StatusBadge tone="error" title="Pick an event-time field on Payments, or switch to processing time.">
        ! 1 problem
      </StatusBadge>
    </div>
  ),
};

export const PlacementPanel: S = {
  render: () => (
    <div className="w-[760px] rounded-lg border border-line">
      <ProblemsPanel
        problems={toProblems([
          { id: '1', location: 'Pipeline', error: new AppError('SIM-NO-SINK', { node: 'Bursts per card' }) },
          {
            id: '2',
            location: 'Window · Bursts',
            error: new AppError('WIN-NO-TIME', { source: 'Payments' }),
          },
          { id: '3', location: 'Join · Refunds', error: new AppError('JOIN-NO-BOUND') },
        ])}
      />
    </div>
  ),
};

function ToastDemo() {
  const toastError = useErrorToast();
  return (
    <Button onClick={() => toastError(new AppError('API-403', { action: 'Stop' }))}>
      Trigger API-403 toast
    </Button>
  );
}
export const PlacementToast: S = { render: () => <ToastDemo /> };

function DialogDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open API-401 dialog</Button>
      <ErrorDialog
        open={open}
        onOpenChange={setOpen}
        error={new AppError('API-401', { conn: 'payments-prod' })}
      />
    </>
  );
}
export const PlacementDialog: S = { render: () => <DialogDemo /> };

export const PlacementPage: S = {
  render: () => (
    <ErrorPage icon={Unplug} error={new AppError('CONN-LINK-EXPIRED', { conn: 'aws-payments' })} />
  ),
};
