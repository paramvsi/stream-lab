import { X } from 'lucide-react';
import { Dialog as R } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';
import { IconButton } from './Button';
import { useReturnFocus } from './focus';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  side?: 'right' | 'bottom';
  /** Width (right) or height (bottom) in px. Right default 480 (board W06d), bottom 360 (SIMULATOR.md). */
  size?: number;
  /** false = no scrim and the page stays usable (the canvas node drawer). */
  modal?: boolean;
  headerExtra?: ReactNode;
  children: ReactNode;
  /** Category accent etc. for the bottom drawer's top border. */
  accent?: string;
  /** Where focus goes on close, when not back to the opener (e.g. opened from a toast that is gone). */
  returnFocusTo?: () => HTMLElement | null | undefined;
}

/** Right drawer slides 300 ms (sl-left), bottom 320 ms (sl-up); Esc closes; focus returns to the trigger. */
// ponytail: resize + collapse-to-40px for the bottom drawer arrive with M2 (board W10*), not here.
export function Drawer({
  open,
  onOpenChange,
  title,
  side = 'right',
  size,
  modal = true,
  headerExtra,
  children,
  accent,
  returnFocusTo,
}: DrawerProps) {
  const right = side === 'right';
  const style: CSSProperties = right
    ? { width: size ?? 480 }
    : { height: size ?? 360, ...(accent ? { borderTop: `3px solid ${accent}` } : {}) };
  const returnFocus = useReturnFocus(open);
  return (
    <R.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <R.Portal>
        {modal && <R.Overlay className="sl-scrim fixed inset-0 z-40 bg-scrim" />}
        <R.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const to = returnFocusTo?.();
            if (!to) return returnFocus(e);
            e.preventDefault();
            to.focus();
          }}
          style={style}
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
          className={`fixed z-40 flex max-w-full flex-col bg-surface shadow-pop outline-none ${
            right
              ? 'sl-drawer-r top-0 right-0 bottom-0 border-l border-line'
              : 'sl-drawer-b right-0 bottom-0 left-0 max-h-[70vh] border-t border-line'
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-[18px]">
            <R.Title className="m-0 text-[17px] font-semibold">{title}</R.Title>
            <div className="flex items-center gap-2">
              {headerExtra}
              <R.Close asChild>
                <IconButton aria-label="Close">
                  <X size={18} aria-hidden="true" />
                </IconButton>
              </R.Close>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">{children}</div>
        </R.Content>
      </R.Portal>
    </R.Root>
  );
}
