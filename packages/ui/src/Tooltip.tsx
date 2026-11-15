import { Tooltip as R } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export const TooltipProvider = R.Provider;

/** Trigger must forward refs and props (Button, IconButton and native elements do). */
export function Tooltip({
  content,
  children,
  onOpenChange,
}: {
  content: ReactNode;
  children: ReactElement;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <R.Root delayDuration={300} {...(onOpenChange ? { onOpenChange } : {})}>
      <R.Trigger asChild>{children}</R.Trigger>
      <R.Portal>
        <R.Content
          sideOffset={6}
          className="z-50 max-w-[280px] rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-[18px] text-white shadow-pop"
        >
          {content}
        </R.Content>
      </R.Portal>
    </R.Root>
  );
}
