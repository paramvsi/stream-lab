import { CATEGORIES, NODES, type NodeType } from '@sl/graph';
import { Tooltip } from '@sl/ui';
import { Search } from 'lucide-react';
import { useId, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { accent, ELLIPSIS, NodeIcon, tint } from './look';

/** MIME type for dragging a palette item onto the canvas. */
export const DRAG_TYPE = 'application/x-streamlab-node';

const ITEMS = Object.values(NODES);

/**
 * SIM-03 / board W09: 264 px library, 6 colour-coded categories, search across all of them,
 * drag onto the canvas or press Enter to add at the viewport centre.
 */
export function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  const [q, setQ] = useState('');
  const searchId = useId();
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? ITEMS.filter((n) => `${n.type} ${n.description} ${n.category}`.toLowerCase().includes(s))
      : ITEMS;
  }, [q]);

  const drag = (type: NodeType) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, type);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const key = (type: NodeType) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onAdd(type);
    }
  };

  return (
    <aside
      aria-label="Node library"
      className="flex w-[264px] shrink-0 flex-col gap-3.5 overflow-hidden border-r border-line bg-surface px-3 py-3.5"
    >
      <h2 className="m-0 text-[14px] font-semibold">Nodes</h2>
      <label
        htmlFor={searchId}
        className="flex h-[38px] items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 focus-within:shadow-[0_0_0_2px_var(--sl-color-surface),0_0_0_4px_var(--sl-color-rose-600)]"
      >
        <Search size={16} aria-hidden="true" className="text-muted" />
        <span className="sr-only">Search nodes</span>
        <input
          id={searchId}
          data-palette-search
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nodes"
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-muted"
        />
        <kbd className="rounded-sm border border-b-2 border-line px-1.5 py-px font-mono text-[11px] text-muted">
          /
        </kbd>
      </label>

      <div className="-mx-1 flex flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        {hits.length === 0 && (
          <p role="status" className="m-0 px-1 text-[13px] text-muted">
            No nodes match &ldquo;{q.trim()}&rdquo;.
          </p>
        )}
        {CATEGORIES.map((c) => {
          const items = hits.filter((n) => n.category === c);
          if (!items.length) return null;
          return (
            <section key={c} aria-label={c} className="flex flex-col gap-1.5">
              <h3 className="m-0 flex items-center gap-2 px-1 py-0.5 text-[12px] font-semibold">
                <span aria-hidden="true" className="size-2 rounded-[3px]" style={{ background: accent(c) }} />
                {c}
                <span className="ml-auto text-[11px] font-normal text-muted">{items.length}</span>
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {items.map((n) => {
                  const v1 = 'v1' in n && n.v1;
                  // A real <button> inside each <li>: the name starts with the visible text (label-in-name).
                  const item = (
                    <button
                      type="button"
                      aria-disabled={v1 || undefined}
                      draggable={!v1}
                      onDragStart={v1 ? undefined : drag(n.type)}
                      onKeyDown={v1 ? undefined : key(n.type)}
                      onDoubleClick={v1 ? undefined : () => onAdd(n.type)}
                      className={`sl-focus flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2 py-[7px] text-left ${v1 ? 'cursor-not-allowed opacity-60' : 'cursor-grab hover:bg-subtle'}`}
                    >
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-[7px]"
                        style={{ background: tint(c) }}
                      >
                        <NodeIcon type={n.type} size={16} color={accent(c)} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[13px] font-semibold">
                          {n.type}
                          {v1 && <span className="font-normal text-muted"> · v1</span>}
                        </span>
                        <span className={`text-[12px] text-muted ${ELLIPSIS}`}>{n.description}</span>
                      </span>
                    </button>
                  );
                  return (
                    <li key={n.type}>
                      {v1 ? (
                        <Tooltip content="Arrives in v1" describe>
                          {item}
                        </Tooltip>
                      ) : (
                        item
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
