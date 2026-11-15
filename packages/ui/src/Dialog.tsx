import { X } from 'lucide-react';
import { Dialog as R } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { useReturnFocus } from './focus';
import { TONE, ToneIcon, type Severity } from './tone';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Says the outcome ("Stop with savepoint?"). Also the accessible name. */
  title: ReactNode;
  severity?: Severity;
  children?: ReactNode;
  /** Buttons that say the verb; rendered right-aligned. */
  footer?: ReactNode;
  width?: number;
  /** Element that opens the dialog is restored on close by Radix; Escape closes. */
  trigger?: ReactNode;
  /** Override where focus lands on open (default: the first focusable element). */
  onOpenAutoFocus?: (e: Event) => void;
  /** Runs on close; call preventDefault to take over focus (else it returns to what opened the dialog). */
  onCloseAutoFocus?: (e: Event) => void;
}

/** Boards WX03 / WM05: scrim rgba(ink,.4); panel 520 px, radius 16, pad 24, gap 18, pop shadow. */
export function Dialog({
  open,
  onOpenChange,
  title,
  severity,
  children,
  footer,
  width = 520,
  trigger,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: DialogProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <R.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <R.Trigger asChild>{trigger}</R.Trigger>}
      <R.Portal>
        <R.Overlay className="sl-scrim fixed inset-0 z-40 bg-scrim" />
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6">
          <R.Content
            aria-describedby={undefined}
            // A caller's handler may take over (preventDefault); otherwise focus returns to the trigger.
            onCloseAutoFocus={(e) => {
              onCloseAutoFocus?.(e);
              if (!e.defaultPrevented) returnFocus(e);
            }}
            {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
            style={{ width }}
            className="pointer-events-auto flex max-h-full max-w-full flex-col gap-[18px] overflow-auto rounded-xl bg-surface p-6 shadow-pop outline-none"
          >
            <div className="flex items-start gap-3.5">
              {severity && (
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${TONE[severity].bg} ${TONE[severity].accent}`}
                >
                  <ToneIcon severity={severity} size={20} />
                </span>
              )}
              <R.Title className="m-0 flex-1 self-center text-[19px] font-semibold">{title}</R.Title>
              <R.Close asChild>
                <IconButton aria-label="Close dialog">
                  <X size={18} aria-hidden="true" />
                </IconButton>
              </R.Close>
            </div>
            {children && (
              <div className="flex min-w-0 flex-col gap-3 text-[15px] leading-[1.6] text-muted">
                {children}
              </div>
            )}
            {footer && <div className="flex flex-wrap justify-end gap-2.5">{footer}</div>}
          </R.Content>
        </div>
      </R.Portal>
    </R.Root>
  );
}

export const DialogClose = R.Close;
