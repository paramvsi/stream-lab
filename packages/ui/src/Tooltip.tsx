import { Tooltip as R } from 'radix-ui';
import { cloneElement, useId, useState, type ReactElement, type ReactNode } from 'react';

export const TooltipProvider = R.Provider;

/**
 * Trigger must forward refs and props (Button, IconButton and native elements do).
 * `describe`: the content also describes the trigger while closed (aria-describedby on a hidden copy), so screen
 * readers and keyboard users always get it. While open, Radix describes the trigger itself, so ours steps aside
 * and the text is read once.
 * `off`: inert (never opens, describes nothing) but the element tree stays the same, so toggling it never
 * re-mounts the trigger (which would drop focus).
 */
export function Tooltip({
  content,
  children,
  describe = false,
  off = false,
}: {
  content: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string | undefined }>;
  describe?: boolean;
  off?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = open && !off;
  const trigger = cloneElement(children, {
    'aria-describedby': describe && !off && !shown ? id : children.props['aria-describedby'],
  });
  return (
    <>
      {/* Own provider: every Button renders a Tooltip, and Radix needs one above each Root. */}
      <R.Provider delayDuration={300}>
        <R.Root open={shown} onOpenChange={setOpen}>
          <R.Trigger asChild>{trigger}</R.Trigger>
          <R.Portal>
            <R.Content
              sideOffset={6}
              className="z-50 max-w-[280px] rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-[18px] text-white shadow-pop"
            >
              {content}
            </R.Content>
          </R.Portal>
        </R.Root>
      </R.Provider>
      {describe && !off && (
        <span id={id} hidden>
          {content}
        </span>
      )}
    </>
  );
}
