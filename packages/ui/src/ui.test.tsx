import { act, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { AlertTriangle } from 'lucide-react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Banner,
  Button,
  EmptyState,
  StatusBadge,
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
    // Closed tooltip: the reason must still describe the button (re-audit #5 — Radix only describes it while open).
    expect(b).toHaveAccessibleDescription('Fix 2 errors to run');
    await userEvent.tab();
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).toHaveAccessibleDescription('Fix 2 errors to run');
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps focus when it switches between enabled and disabled-with-reason (M1 audit #8)', async () => {
    function Harness() {
      const [n, setN] = useState(1);
      return (
        <TooltipProvider>
          <Button disabledReason={n === 0 ? 'Nothing to undo.' : undefined} onClick={() => setN(0)}>
            Undo
          </Button>
        </TooltipProvider>
      );
    }
    render(<Harness />);
    const b = screen.getByRole('button', { name: 'Undo' });
    b.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Undo' })).toBe(b); // same element, not re-mounted
    expect(b).toHaveFocus();
    expect(b).toHaveAccessibleDescription('Nothing to undo.');
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
  it('error is assertive (role=alert), others polite (role=status)', async () => {
    render(
      <>
        <Banner severity="error">a</Banner>
        <Banner severity="warning">b</Banner>
      </>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Error: a'));
    expect(screen.getByRole('status')).toHaveTextContent('Warning: b');
  });

  it('mounts its live region empty, then fills it, so screen readers announce it', async () => {
    // First paint (no effects) must not contain the text; after effects it does.
    expect(renderToStaticMarkup(<Banner severity="warning">Lost contact</Banner>)).not.toContain(
      'Lost contact',
    );
    render(<Banner severity="warning">Lost contact</Banner>);
    expect(screen.getByRole('status')).toHaveTextContent('');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Lost contact'));
  });

  it('actions are held back too, so the region is inserted truly empty (re-audit #4)', () => {
    const html = renderToStaticMarkup(
      <Banner severity="error" actions={<button>Retry</button>}>
        Lost contact
      </Banner>,
    );
    expect(html).not.toContain('Retry');
    const page = renderToStaticMarkup(
      <EmptyState icon={AlertTriangle} severity="error" title="x" actions={<button>Retry</button>} />,
    );
    expect(page).not.toContain('Retry');
  });

  it('a full-page error state is announced the same way', async () => {
    const page = (
      <EmptyState icon={AlertTriangle} severity="error" title="Could not reach payments-prod">
        Nothing is listening.
      </EmptyState>
    );
    expect(renderToStaticMarkup(page)).not.toContain('Could not reach');
    render(page);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not reach payments-prod'));
  });

  it('only info banners can be dismissed', async () => {
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
    expect(await screen.findAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
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

  it('a sorted column says so on its header (aria-sort); others say nothing', () => {
    render(
      <Table
        label="Jobs"
        rows={[{ id: 'j1', name: 'fraud-scoring' }]}
        rowKey={(r) => r.id}
        columns={[
          { key: 'n', header: 'Job', sort: 'ascending', render: (r) => r.name },
          { key: 's', header: 'Status', render: () => 'Running' },
        ]}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Job' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'Status' })).not.toHaveAttribute('aria-sort');
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

describe('UI · StatusBadge', () => {
  it('a badge with a reason is keyboard-reachable and describes the reason', async () => {
    render(
      <TooltipProvider>
        <StatusBadge tone="error" reason="Pick an event-time field on Payments.">
          1 problem
        </StatusBadge>
      </TooltipProvider>,
    );
    const badge = screen.getByText('1 problem').closest('span[tabindex]');
    expect(badge).toHaveAccessibleDescription('Pick an event-time field on Payments.'); // tooltip closed
    await userEvent.tab();
    expect(badge).toHaveFocus();
    expect(badge).toHaveAccessibleDescription('Pick an event-time field on Payments.');
  });
});

describe('UI · Toast', () => {
  it('the toast element matches the entrance-motion selector', async () => {
    render(
      <ToastProvider>
        <ToastHarness n={1} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('go'));
    const li = document.querySelector('.sl-toast');
    // Radix's toast <li> has no role, so the seed rule `[role=status].sl-toast` never matched (audit #5).
    expect(li?.matches(".sl-toast[data-state='open']")).toBe(true);
    const css = readFileSync(`${__dirname}/styles.css`, 'utf8');
    expect(css).toContain(".sl-toast[data-state='open']");
    expect(css).toContain(".sl-toast[data-state='closed']");
    // Motion tokens only (MOTION.md "one ease"; DoD "uses the tokens") — re-audit #6.
    const toastRules = css.slice(css.indexOf(".sl-toast[data-state='open']"));
    expect(toastRules).not.toMatch(/\d+ms|cubic-bezier/);
  });

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
