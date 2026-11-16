import { AppError, present } from '@sl/errors';
import { NODES, type NodeType } from '@sl/graph';
import { Dialog } from '@sl/ui';
import { useReactFlow } from '@xyflow/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useGraph } from './store';

export const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command palette'],
  ['/', 'Add a node (quick-add)'],
  ['?', 'Keyboard shortcuts'],
  ['Enter', 'Open the focused node'],
  ['⌘Z', 'Undo'],
  ['⇧⌘Z or ⌘Y', 'Redo'],
  ['⌘C / ⌘V', 'Copy / paste the selection'],
  ['⌘D', 'Duplicate the selection'],
  ['⌫ or Delete', 'Delete the selection'],
  ['Arrow keys', 'Move the selected node'],
  ['Shift + click', 'Add to the selection'],
];

/** SIM-22: the keyboard shortcuts sheet, opened with `?`. */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Keyboard shortcuts" width={480}>
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

interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Why it can't run now (shown in words; Enter does nothing). */
  disabled?: string | undefined;
  run: () => void;
}

/** Board W09p: ⌘K command palette over the workspace (search, ↑/↓, Enter). */
export function CommandPalette({
  onClose,
  onAdd,
  onLayout,
  onShortcuts,
}: {
  onClose: () => void;
  onAdd: (type: NodeType) => void;
  onLayout: () => void;
  onShortcuts: () => void;
}) {
  const rf = useReactFlow();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const all = useMemo<Command[]>(() => {
    const g = useGraph.getState;
    const t = useGraph.temporal.getState;
    return [
      ...Object.values(NODES)
        .filter((n) => !('v1' in n && n.v1))
        .map((n) => ({
          id: `add-${n.type}`,
          label: `Add ${n.type}`,
          hint: n.category,
          run: () => onAdd(n.type),
        })),
      { id: 'layout', label: 'Auto-layout', run: onLayout },
      { id: 'fit', label: 'Fit view', run: () => void rf.fitView({ duration: 300, maxZoom: 1 }) },
      { id: 'all', label: 'Select all', run: () => g().select(g().nodes.map((n) => n.id)) },
      {
        id: 'undo',
        label: 'Undo',
        hint: '⌘Z',
        disabled: t().pastStates.length ? undefined : present(new AppError('SIM-UNDO-EMPTY')).message,
        run: () => t().undo(),
      },
      {
        id: 'redo',
        label: 'Redo',
        hint: '⇧⌘Z',
        disabled: t().futureStates.length ? undefined : present(new AppError('SIM-REDO-EMPTY')).message,
        run: () => t().redo(),
      },
      { id: 'keys', label: 'Keyboard shortcuts', hint: '?', run: onShortcuts },
    ];
  }, [onAdd, onLayout, onShortcuts, rf]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(s)) : all;
  }, [all, q]);

  // Keep the active option in view as ↑/↓ move it (aria-activedescendant does not scroll).
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);
  const pick = (i: number) => {
    const c = items[i];
    if (!c || c.disabled) return;
    onClose();
    // After the dialog has closed and returned focus, so a command that opens something keeps focus sane.
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
        placeholder="Type a command or a node…"
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
            aria-disabled={c.disabled ? true : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(i)}
            className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-[14px] text-ink aria-selected:bg-rose-50"
          >
            <span className="flex flex-col">
              <span className={c.disabled ? 'text-line-strong' : ''}>{c.label}</span>
              {c.disabled && <span className="text-[12px] text-muted">{c.disabled}</span>}
            </span>
            {c.hint && <span className="font-mono text-[12px] text-muted">{c.hint}</span>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
