import type { Key, ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** JetBrains Mono, tabular numbers (ids, numbers). */
  mono?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  /** Accessible name. */
  label: string;
  dense?: boolean;
  selectedKey?: Key | null;
  onSelect?: (row: T) => void;
  /** Max height before the body scrolls under a sticky header. */
  maxHeight?: number;
}

/** Board D07: line border, radius 12, header 12/500 muted on subtle, cells 14 px pad 13/14, selected rose-50. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  label,
  dense,
  selectedKey,
  onSelect,
  maxHeight,
}: TableProps<T>) {
  const pad = dense ? 'py-2 px-3.5' : 'py-[13px] px-3.5';
  return (
    <div
      className="sl-focus overflow-auto rounded-lg border border-line bg-surface"
      style={maxHeight ? { maxHeight } : undefined}
      // A scrolling body must be reachable by keyboard (axe scrollable-region-focusable); the table inside
      // carries the name, so the wrapper has none (no double announcement).
      {...(maxHeight ? { tabIndex: 0 } : {})}
    >
      <table aria-label={label} className="w-full border-collapse text-ink">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`sticky top-0 border-b border-line bg-subtle px-3.5 py-2.5 text-[12px] font-medium whitespace-nowrap text-muted ${c.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            const selected = selectedKey === k;
            return (
              <tr
                key={k}
                // Only a table that tracks a selection says "selected"; a list of links-as-rows does not.
                aria-selected={onSelect && selectedKey !== undefined ? selected : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(r) : undefined}
                onKeyDown={
                  onSelect
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelect(r);
                        }
                      }
                    : undefined
                }
                className={`sl-focus ${selected ? 'bg-rose-50' : 'bg-surface'} ${onSelect ? 'cursor-pointer hover:bg-subtle' : ''}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b border-line align-middle whitespace-nowrap ${pad} ${c.mono ? 'font-mono text-[12px] tabular-nums' : 'text-[14px]'} ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
