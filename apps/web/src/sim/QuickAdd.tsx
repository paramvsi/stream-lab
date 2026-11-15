import { NODES, spec, type NodeType } from '@sl/graph';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { accent, NodeIcon, tint } from './look';

/** Where quick-add was opened from: decides which nodes fit (SIM-04, SIM-08, SIM-09). */
export type QuickAddNeed = 'any' | 'input' | 'output' | 'both';

const fits = (type: NodeType, need: QuickAddNeed) => {
  const s = spec(type);
  const d = s.defaults();
  const hasIn = s.inputs(d).length > 0;
  const hasOut = s.outputs(d).length > 0;
  return need === 'any' || (need === 'input' ? hasIn : need === 'output' ? hasOut : hasIn && hasOut);
};

/** Board W09b: opens at the cursor, keyboard-first: type to filter, ↑/↓, Enter inserts, Esc closes. */
export function QuickAdd({
  x,
  y,
  need,
  allow,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  need: QuickAddNeed;
  /** Extra filter: only nodes the connection rules would accept from where quick-add was opened. */
  allow?: ((type: NodeType) => boolean) | undefined;
  onPick: (type: NodeType) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Esc returns focus to where quick-add was opened from (a pick moves it to the new node instead).
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const listId = useId();
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return Object.values(NODES).filter(
      (n) =>
        !('v1' in n && n.v1) &&
        fits(n.type, need) &&
        (!allow || allow(n.type)) &&
        (!s || `${n.type} ${n.description}`.toLowerCase().includes(s)),
    );
  }, [q, need, allow]);
  useEffect(() => input.current?.focus(), []);
  const close = () => {
    onClose();
    const el = opener.current;
    if (el instanceof HTMLElement && el !== document.body && el.isConnected) el.focus();
  };
  const pick = (i: number) => {
    const n = items[i];
    if (n) onPick(n.type);
  };

  return (
    <div
      role="dialog"
      aria-label="Add a node"
      style={{ left: x, top: y }}
      className="fixed z-30 flex w-[300px] flex-col gap-1 rounded-xl border border-line bg-surface p-2 shadow-pop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <input
        ref={input}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
        aria-label="Search nodes to add"
        placeholder="Add a node…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onBlur={(e) => {
          // Clicking an option fires blur first; let the click land.
          if (!e.relatedTarget || !e.currentTarget.parentElement?.contains(e.relatedTarget))
            setTimeout(onClose, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') pick(active);
          else return;
          e.preventDefault();
        }}
        className="sl-focus h-9 rounded-md border border-line-strong px-2.5 text-[14px]"
      />
      {items.length === 0 && (
        <p role="status" className="m-0 px-2.5 py-2 text-[13px] text-muted">
          No nodes match
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Nodes"
        className="m-0 max-h-[320px] list-none overflow-y-auto p-0"
      >
        {items.map((n, i) => (
          <li
            key={n.type}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
            onMouseEnter={() => setActive(i)}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 aria-selected:bg-rose-50"
          >
            <span
              className="flex size-7 items-center justify-center rounded-[7px]"
              style={{ background: tint(n.category) }}
            >
              <NodeIcon type={n.type} size={16} color={accent(n.category)} />
            </span>
            <span className="flex flex-col">
              <span className="text-[13px] font-semibold">{n.type}</span>
              <span className="text-[12px] text-muted">{n.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
