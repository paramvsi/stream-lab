import { Button, Dialog } from '@sl/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  /** Shown at the right, and searched too (e.g. the environment). */
  hint?: string;
  run: () => void;
}

/**
 * APP-01 / board G01: the ⌘K command palette (search, ↑/↓, Enter, Escape). Every typed word must appear in a
 * command's label or hint. A command runs after the dialog has closed and given focus back, so the screen it opens
 * starts at its heading.
 * ponytail: the web workspace has its own (apps/web/src/sim/Commands.tsx, same pattern); one shared palette in
 * packages/ui when a third appears.
 */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const items = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      const t = `${c.label} ${c.hint ?? ''}`.toLowerCase();
      return words.every((w) => t.includes(w));
    });
  }, [commands, q]);
  // Keep the active option in view as ↑/↓ move it (aria-activedescendant does not scroll).
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);
  const pick = (i: number) => {
    const c = items[i];
    if (!c) return;
    onClose();
    setTimeout(c.run, 0);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Commands"
      width={560}
      onOpenAutoFocus={(e) => {
        e.preventDefault(); // the search box, not the close button
        input.current?.focus();
      }}
    >
      <input
        ref={input}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
        aria-label="Search commands"
        placeholder="Jump to job, cluster, action"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') pick(active);
          else return;
          e.preventDefault();
        }}
        className="sl-focus h-10 rounded-md border border-line-strong px-3 text-[14px] text-ink"
      />
      <p role="status" className={items.length === 0 ? 'm-0 text-[14px]' : 'sr-only'}>
        {items.length === 0 ? 'No commands match.' : ''}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="m-0 max-h-[360px] list-none overflow-y-auto p-0"
      >
        {items.map((c, i) => (
          <li
            key={c.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(i)}
            className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-[14px] text-ink aria-selected:bg-rose-50"
          >
            <span>{c.label}</span>
            {c.hint && <span className="text-[12px] text-muted">{c.hint}</span>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Board G02. Only keys that work today are listed (the board's R, E and S belong to screens: not built yet). */
export const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command palette'],
  ['⌘1–9', 'Switch connection'],
  ['G J', 'Go to jobs'],
  ['G L', 'Go to logs'],
  ['?', 'This list'],
];

/** APP-01 / board G02: the keyboard shortcuts sheet ("?" or the palette). */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Keyboard shortcuts"
      width={620}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <table className="w-full border-collapse text-[14px] text-ink">
        <caption className="sr-only">Keyboard shortcuts</caption>
        <tbody>
          {SHORTCUTS.map(([k, what]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                <kbd className="rounded-sm border border-b-2 border-line px-1.5 py-px font-mono text-[12px] text-muted">
                  {k}
                </kbd>
              </th>
              <td className="py-2">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
