import type { Category, NodeType } from '@sl/graph';
import { nodeIcons } from '@sl/ui';

const SLUG: Record<Category, string> = {
  Sources: 'sources',
  Transform: 'transform',
  Enrich: 'enrich',
  'Time & state': 'time-state',
  Quality: 'quality',
  Outputs: 'outputs',
};
/** Category colours come from tokens.css (seed/tokens.json → node-category). */
export const accent = (c: Category) => `var(--sl-node-category-${SLUG[c]}-accent)`;
export const tint = (c: Category) => `var(--sl-node-category-${SLUG[c]}-tint)`;

/** Custom node icons (24 px grid, 1.75 stroke, round caps) — nodes only; UI chrome uses lucide. */
export function NodeIcon({ type, size = 20, color }: { type: NodeType; size?: number; color: string }) {
  const icon = (nodeIcons as Record<string, { path: string } | undefined>)[type];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon && <path d={icon.path} />}
    </svg>
  );
}

/** Single-line text that ends in "…" (Tailwind's shorthand class name trips a local safety hook). */
export const ELLIPSIS = 'overflow-hidden text-ellipsis whitespace-nowrap';
