import { useEffect, useRef } from 'react';

/**
 * A new screen starts at its heading (DoD): after a click that replaced the screen, focus would otherwise be on
 * <body>, and a screen reader would not hear that anything changed. Not on first load, not when focus is
 * somewhere on purpose.
 */
export function useScreenHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body || !document.activeElement) ref.current?.focus();
  }, []);
  return ref;
}
