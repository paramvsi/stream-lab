import type { CSSProperties, ReactNode } from 'react';

/** Board D07d: subtle fill, 1 px line border, radius 8. Static (no shimmer on the board). */
export function Skeleton({
  width = '100%',
  height = 40,
  className = '',
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width, height }}
      className={`block rounded-md border border-line bg-subtle ${className}`}
    />
  );
}

/** Wrap skeletons so screen readers hear one "Loading …" instead of nothing. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-2">
      {children}
    </div>
  );
}
