import type { Meta, StoryObj } from '@storybook/react-vite';
import { Play, Settings, Trash2 } from 'lucide-react';
import { Button, IconButton } from './Button';

/** Boards WM04 (Default · Hover · Focus · Disabled) and the button styles used across every board. */
const meta = { title: 'UI/Button', component: Button } satisfies Meta<typeof Button>;
export default meta;
type S = StoryObj<typeof meta>;

export const Variants: S = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-3">
          <Button size={size} variant="primary" icon={<Play size={16} aria-hidden />}>
            Run
          </Button>
          <Button size={size}>Test connection</Button>
          <Button size={size} variant="ghost">
            Copy details
          </Button>
          <Button size={size} variant="danger" icon={<Trash2 size={16} aria-hidden />}>
            Cancel job
          </Button>
        </div>
      ))}
    </div>
  ),
};

export const Loading: S = { args: { variant: 'primary', loading: true, children: 'Saving' } };

/** Rule 5: disabled actions explain why (tooltip + aria-describedby). */
export const DisabledWithReason: S = {
  args: { variant: 'primary', disabledReason: 'Fix 2 errors to run', children: 'Run' },
};

export const Disabled: S = { args: { disabled: true, children: 'Save' } };

export const IconButtons: S = {
  render: () => (
    <div className="flex gap-3">
      <IconButton aria-label="Settings">
        <Settings size={18} aria-hidden />
      </IconButton>
      <IconButton aria-label="Settings" size="sm" bordered={false}>
        <Settings size={16} aria-hidden />
      </IconButton>
      <IconButton aria-label="Settings" disabled>
        <Settings size={18} aria-hidden />
      </IconButton>
    </div>
  ),
};
