import { useLayoutEffect, useRef } from 'react';

/**
 * Focus goes back to whatever opened the overlay, even when it was not a Radix Trigger
 * (DoD: "Focus returns to the trigger"). Pass the result to Radix `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean) {
  const last = useRef<HTMLElement | null>(null);
  // Layout effect: runs before Radix's FocusScope moves focus into the overlay.
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) last.current = document.activeElement;
  }, [open]);
  return (e: Event) => {
    const el = last.current;
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus();
    }
  };
}
