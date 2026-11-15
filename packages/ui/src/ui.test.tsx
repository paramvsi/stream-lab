import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Banner,
  Button,
  Dialog,
  Drawer,
  Field,
  Input,
  Table,
  Tabs,
  TOAST_MS,
  ToastProvider,
  TooltipProvider,
  useToast,
} from './index';

describe('UI · Button', () => {
  it('disabledReason keeps it focusable, blocks clicks and describes why', async () => {
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <Button disabledReason="Fix 2 errors to run" onClick={onClick}>
          Run
        </Button>
      </TooltipProvider>,
    );
    const b = screen.getByRole('button', { name: /run/i });
    await userEvent.tab();
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).toHaveAccessibleDescription('Fix 2 errors to run');
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading is busy and does not click', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('UI · Field', () => {
  it('wires label, error and aria-invalid to the control', () => {
    render(
      <Field label="JobManager REST URL" error="Enter a full address like https://flink.example.com:8081.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('JobManager REST URL');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a full address like https://flink.example.com:8081.');
  });

  it('help text describes a valid field', () => {
    render(
      <Field label="Name" help="Shown in the fleet view.">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Shown in the fleet view.');
  });
});

describe('UI · Banner', () => {
  it('error is assertive (role=alert), others polite (role=status)', () => {
    render(
      <>
        <Banner severity="error">a</Banner>
        <Banner severity="warning">b</Banner>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Error: a');
    expect(screen.getByRole('status')).toHaveTextContent('Warning: b');
  });

  it('only info banners can be dismissed', () => {
    render(
      <>
        <Banner severity="warning" onDismiss={() => {}}>
          w
        </Banner>
        <Banner severity="info" onDismiss={() => {}}>
          i
        </Banner>
      </>,
    );
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Stop with savepoint?"
      trigger={<Button>Stop job</Button>}
    >
      <p>The job stops after a savepoint is written.</p>
    </Dialog>
  );
}

describe('UI · Dialog', () => {
  it('is named by its title, Escape closes, focus returns to the trigger', async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Stop job' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Stop with savepoint?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open concept</Button>
      <Drawer open={open} onOpenChange={setOpen} title="Concept">
        <p>Watermark</p>
      </Drawer>
    </>
  );
}

describe('UI · Drawer', () => {
  it('is named, Escape closes, focus returns', async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: 'Open concept' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Concept' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('UI · Tabs', () => {
  it('arrow keys move between tabs and show the count', async () => {
    render(
      <Tabs
        label="Job sections"
        items={[
          { value: 'a', label: 'Overview', content: 'A' },
          { value: 'b', label: 'Exceptions', count: 2, content: 'B' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Exceptions 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B');
  });
});

describe('UI · Table', () => {
  it('rows are selectable with the keyboard', async () => {
    const onSelect = vi.fn();
    render(
      <Table
        label="Jobs"
        rows={[{ id: 'j1', name: 'fraud-scoring' }]}
        rowKey={(r) => r.id}
        onSelect={onSelect}
        columns={[{ key: 'n', header: 'Job', render: (r) => r.name }]}
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith({ id: 'j1', name: 'fraud-scoring' });
  });
});

function ToastHarness({ n }: { n: number }) {
  const toast = useToast();
  return (
    <button
      onClick={() => Array.from({ length: n }, (_, i) => toast({ severity: 'info', message: `t${i}` }))}
    >
      go
    </button>
  );
}

describe('UI · Toast', () => {
  it('keeps at most 3 stacked, newest last', async () => {
    render(
      <ToastProvider>
        <ToastHarness n={5} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('go'));
    const shown = ['t0', 't1', 't2', 't3', 't4'].filter((t) => screen.queryAllByText(t).length > 0);
    expect(shown).toEqual(['t2', 't3', 't4']);
  });

  it('durations follow the severity table', () => {
    expect(TOAST_MS).toEqual({ success: 4000, info: 4000, warning: 6000, error: 8000 });
  });

  it('auto-dismisses after its duration', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness n={1} />
      </ToastProvider>,
    );
    act(() => screen.getByText('go').click());
    expect(screen.queryAllByText('t0').length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(TOAST_MS.info + 500));
    expect(screen.queryAllByText('t0')).toHaveLength(0);
    vi.useRealTimers();
  });
});
