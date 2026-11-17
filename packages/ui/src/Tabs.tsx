import { Tabs as R } from 'radix-ui';
import type { ReactNode } from 'react';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** A number, or "16+" for a lower bound. */
  count?: number | string;
  content: ReactNode;
}

/** Board D08: 14 px / 500, muted → ink when active, 2 px rose-600 underline, count pill in subtle. */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  pill = false,
}: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Board W05: small bordered pills (a chapter's sections), the active one rose. */
  pill?: boolean;
}) {
  return (
    <R.Root
      {...(value !== undefined ? { value } : {})}
      defaultValue={defaultValue ?? items[0]?.value}
      {...(onValueChange ? { onValueChange } : {})}
      className="flex min-w-0 flex-col"
    >
      <R.List
        aria-label={label}
        className={pill ? 'flex flex-wrap gap-2' : 'flex flex-wrap gap-6 border-b border-line'}
      >
        {items.map((t) => (
          <R.Trigger
            key={t.value}
            value={t.value}
            className={
              pill
                ? 'sl-focus inline-flex items-center rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-ink hover:bg-subtle data-[state=active]:border-rose-100 data-[state=active]:bg-rose-50 data-[state=active]:text-rose-700'
                : 'sl-focus -mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-0.5 py-3 text-[14px] font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-rose-600 data-[state=active]:text-ink'
            }
          >
            {t.label}
            {t.count !== undefined && ' '}
            {t.count !== undefined && (
              <span className="rounded-pill bg-subtle px-[7px] py-px font-mono text-[11px] text-muted tabular-nums">
                {t.count}
              </span>
            )}
          </R.Trigger>
        ))}
      </R.List>
      {items.map((t) => (
        <R.Content key={t.value} value={t.value} className="sl-focus pt-4">
          {t.content}
        </R.Content>
      ))}
    </R.Root>
  );
}
