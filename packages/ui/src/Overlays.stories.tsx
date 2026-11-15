import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Drawer } from './Drawer';

/** Boards WM05 (dialog open/close), WX03 (blocking error dialog), W06d (right drawer), W10* (bottom drawer). */
const meta = { title: 'UI/Overlays' } satisfies Meta;
export default meta;
type S = StoryObj<typeof meta>;

function StopDialog({ initial }: { initial: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Stop with savepoint?"
      trigger={<Button>Stop job</Button>}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Stop
          </Button>
        </>
      }
    >
      <p className="m-0">The job stops after a savepoint is written.</p>
    </Dialog>
  );
}

export const DialogDecision: S = { render: () => <StopDialog initial /> };
export const DialogClosed: S = { render: () => <StopDialog initial={false} /> };

export const DialogError: S = {
  render: () => (
    <Dialog
      open
      onOpenChange={() => {}}
      severity="error"
      title="The simulator stopped"
      footer={
        <>
          <Button variant="ghost">Copy details</Button>
          <Button variant="primary">Reload simulator</Button>
        </>
      }
    >
      <p className="m-0">
        The engine ran out of memory at event 38,200 (the browser limits each tab). Your pipeline is safe; it
        was autosaved 5 s ago.
      </p>
      <Banner severity="info">
        Try fewer events, or a shorter state TTL on <b>Bursts per card</b>.
      </Banner>
    </Dialog>
  ),
};

function RightDrawer() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open concept</Button>
      <Drawer open={open} onOpenChange={setOpen} title="Concept">
        <span className="font-mono text-[11px] text-rose-600">CONCEPT</span>
        <h2 className="m-0 text-[24px] leading-[1.2] font-semibold">Watermark</h2>
        <p className="m-0 text-[15px] leading-[1.6]">
          A watermark is Flink&apos;s estimate of how far event time has progressed. A watermark of 12:04:07
          says: &quot;I don&apos;t expect any more events earlier than 12:04:07.&quot;
        </p>
      </Drawer>
    </>
  );
}
export const DrawerRight: S = { render: () => <RightDrawer /> };

export const DrawerBottom: S = {
  render: () => (
    <Drawer
      open
      onOpenChange={() => {}}
      side="bottom"
      modal={false}
      title="Bursts per card"
      accent="var(--sl-node-category-time-state-accent)"
    >
      <p className="m-0 text-muted">Node settings render here (M2).</p>
    </Drawer>
  ),
};
