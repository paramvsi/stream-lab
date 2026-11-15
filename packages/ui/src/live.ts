import { useEffect, useState } from 'react';

/**
 * Live regions inserted already filled are often not announced (NVDA, VoiceOver).
 * Render the region empty first, then fill it on the next frame (after it has been painted).
 */
export function useLiveFill() {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return filled;
}
