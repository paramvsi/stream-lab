import { Loader2 } from 'lucide-react';
import { forwardRef, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
// ponytail: no `lg` size — no board defines one. Add it when a board does.
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700 hover:border-rose-700',
  secondary: 'bg-surface text-ink border-line hover:bg-subtle',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-subtle',
  danger: 'bg-danger-600 text-white border-danger-600 hover:brightness-90',
};
// Boards: sm 32 px / 13 px / pad 12; md min-height 44 (touch) / 14 px / pad 16.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 min-h-8 px-3 text-[13px]',
  md: 'h-10 min-h-11 px-4 text-[14px]',
};
const DISABLED = 'bg-subtle text-line-strong border-line cursor-not-allowed hover:bg-subtle';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /** Disables the button and explains why (tooltip + aria-describedby). Rule 5 of ERRORS_AND_ALERTS.md. */
  disabledReason?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading,
    icon,
    disabledReason,
    disabled,
    className = '',
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const reasonId = useId();
  // While the tooltip is open Radix describes the button itself; ours steps aside so the reason is read once.
  const [tipOpen, setTipOpen] = useState(false);
  // aria-disabled (not `disabled`) keeps the button focusable so keyboard users can reach the reason.
  const off = Boolean(disabled || disabledReason || loading);
  const btn = (
    <button
      ref={ref}
      type="button"
      {...rest}
      aria-disabled={off || undefined}
      aria-busy={loading || undefined}
      aria-describedby={disabledReason ? (tipOpen ? undefined : reasonId) : rest['aria-describedby']}
      onClick={(e) => (off ? e.preventDefault() : onClick?.(e))}
      className={`sl-focus inline-flex items-center gap-2 rounded-md border font-semibold whitespace-nowrap transition-colors ${SIZE[size]} ${off && !loading ? DISABLED : VARIANT[variant]} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
  if (!disabledReason) return btn;
  return (
    <>
      <Tooltip content={disabledReason} onOpenChange={setTipOpen}>
        {btn}
      </Tooltip>
      {/* Outside the button so it describes it without becoming part of its name. */}
      <span id={reasonId} hidden>
        {disabledReason}
      </span>
    </>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need a name. */
  'aria-label': string;
  size?: 'sm' | 'md';
  bordered?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', bordered = true, className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={`sl-focus inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:text-line-strong ${size === 'sm' ? 'size-8' : 'size-9'} ${bordered ? 'border border-line' : ''} ${className}`}
    />
  );
});
