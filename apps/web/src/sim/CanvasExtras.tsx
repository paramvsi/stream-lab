import { AppError, present } from '@sl/errors';
import { connectionIssue, inputsOf, labelOf, outputsOf, spec, type PipelineNode } from '@sl/graph';
import { Button, Dialog, Drawer, Field, Input, useToast } from '@sl/ui';
import { useReactFlow, ViewportPortal } from '@xyflow/react';
import { DropdownMenu } from 'radix-ui';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { autoLayout } from './geometry';
import { useGraph } from './store';

/* ---------- actions shared by the toolbar, the context menus and the shortcuts ---------- */

export interface NodeActionsApi {
  configure: (id: string) => void;
  connectFrom: (id: string) => void;
  remove: (ids: string[]) => void;
  layout: () => void;
  addAt: (clientX: number, clientY: number) => void;
  insertOnEdge: (edgeId: string, clientX: number, clientY: number) => void;
}
export const NodeActions = createContext<NodeActionsApi | null>(null);
export function useNodeActions() {
  const a = useContext(NodeActions);
  if (!a) throw new Error('NodeActions provider missing');
  return a;
}

/** SIM-13: elkjs layout, positions animate 300 ms, one undo step, toast "Layout applied" with Undo. */
export function useAutoLayout() {
  const toast = useToast();
  const rf = useReactFlow();
  return useCallback(async () => {
    const { nodes, edges } = useGraph.getState();
    if (!nodes.length) return;
    const before = Object.fromEntries(nodes.map((n) => [n.id, n.position]));
    const pos = await autoLayout(nodes, edges);
    const root = document.querySelector('.react-flow');
    root?.classList.add('sl-animate-layout');
    useGraph.getState().setPositions(pos, 'Auto-layout');
    setTimeout(() => {
      root?.classList.remove('sl-animate-layout');
      void rf.fitView({ duration: 300, maxZoom: 1 });
    }, 320);
    toast({
      severity: 'success',
      message: 'Layout applied',
      // Puts back the previous positions as a new step (not "undo the last step", which may be something else).
      action: {
        label: 'Undo',
        onClick: () => {
          const alive = new Set(useGraph.getState().nodes.map((n) => n.id));
          useGraph
            .getState()
            .setPositions(
              Object.fromEntries(Object.entries(before).filter(([id]) => alive.has(id))),
              'Restored layout',
            );
        },
      },
    });
  }, [rf, toast]);
}

/* ---------- SIM-05 helper lines ---------- */

export function HelperLines({ x, y }: { x?: number | undefined; y?: number | undefined }) {
  if (x === undefined && y === undefined) return null;
  const big = 100000;
  return (
    <ViewportPortal>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute overflow-visible"
        style={{ left: 0, top: 0, width: 1, height: 1 }}
      >
        {x !== undefined && (
          <line
            x1={x}
            x2={x}
            y1={-big}
            y2={big}
            stroke="var(--sl-color-rose-500)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}
        {y !== undefined && (
          <line
            x1={-big}
            x2={big}
            y1={y}
            y2={y}
            stroke="var(--sl-color-rose-500)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}
      </svg>
    </ViewportPortal>
  );
}

/* ---------- D21: connect by keyboard ---------- */

/**
 * "Connect to…": every input port of every other node, each enabled or disabled with the same catalog reason
 * the canvas shows while dragging (SIM-CYCLE, SIM-PORT-TYPE, SIM-DUP-EDGE, SIM-PORT-TAKEN).
 */
export function ConnectPicker({ fromId, onClose }: { fromId: string; onClose: () => void }) {
  const { nodes, edges } = useGraph.getState();
  const from = nodes.find((n) => n.id === fromId);
  const [port, setPort] = useState(() => (from ? (outputsOf(from)[0]?.id ?? 'main') : 'main'));
  if (!from) return null;
  const outs = outputsOf(from);
  const targets = nodes
    .filter((n) => n.id !== fromId)
    .flatMap((n) =>
      inputsOf(n).map((p) => {
        const issue = connectionIssue(
          { nodes, edges },
          { source: fromId, sourceHandle: port, target: n.id, targetHandle: p.id },
        );
        return { n, p, reason: issue ? present(new AppError(issue.code, issue.params)).message : undefined };
      }),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Connect ${labelOf(from)} to…`} width={480}>
      {outs.length > 1 && (
        <Field label="From output">
          <select
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="sl-focus h-10 rounded-md border border-line-strong px-3 text-[14px] text-ink"
          >
            {outs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {targets.length === 0 ? (
        <p className="m-0">There is no node with an input to connect to yet.</p>
      ) : (
        <ul className="m-0 flex max-h-[360px] list-none flex-col gap-1.5 overflow-y-auto p-0">
          {targets.map(({ n, p, reason }) => (
            <li key={`${n.id}-${p.id}`}>
              <Button
                className="w-full justify-start"
                disabledReason={reason}
                onClick={() => {
                  useGraph
                    .getState()
                    .connect({ source: fromId, sourceHandle: port, target: n.id, targetHandle: p.id });
                  onClose();
                }}
              >
                {n.type} · {labelOf(n)}
                {inputsOf(n).length > 1 && <span className="font-normal text-muted"> ({p.label})</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* ---------- Configure (NODE-01 lands in M2; M1 offers rename and the node's docs) ---------- */

export function NodeDrawer({ node, onClose }: { node: PipelineNode; onClose: () => void }) {
  const [name, setName] = useState(node.label ?? '');
  const s = spec(node.type);
  const commit = () => {
    if (name !== (node.label ?? '')) useGraph.getState().rename(node.id, name);
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => {
        if (!o) {
          commit();
          onClose();
        }
      }}
      side="bottom"
      modal={false}
      size={260}
      title={`${node.type} · ${labelOf(node)}`}
      accent={`var(--sl-node-category-${s.category === 'Time & state' ? 'time-state' : s.category.toLowerCase()}-accent)`}
    >
      <div className="flex max-w-[480px] flex-col gap-3">
        <Field label="Name" help={`Shown on the node. Empty uses "${node.type}".`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} />
        </Field>
        <p className="m-0 text-[14px] text-muted">{s.description}.</p>
      </div>
    </Drawer>
  );
}

/* ---------- SIM-10 context menus (pane, node, edge) ---------- */

/**
 * Opened from React Flow's onNode/Edge/PaneContextMenu at the cursor. A controlled dropdown, not Radix
 * ContextMenu: with right-button panning (panOnDrag [1, 2]) React Flow prevents the pane's contextmenu
 * default, which Radix ContextMenu then ignores.
 */
export type MenuTarget = (
  | { kind: 'pane'; x: number; y: number }
  | { kind: 'node'; id: string; x: number; y: number }
  | { kind: 'edge'; id: string; x: number; y: number }
) & { opener?: HTMLElement | null };

/** What to give focus back to when a context menu closes: the node right-clicked, else whatever had focus. */
export function menuOpener(e: { target: EventTarget | null }): HTMLElement | null {
  const node = e.target instanceof Element ? e.target.closest<HTMLElement>('.react-flow__node') : null;
  if (node) return node;
  const a = document.activeElement;
  return a instanceof HTMLElement && a !== document.body ? a : null;
}

const itemCls =
  'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] text-ink outline-none data-[highlighted]:bg-rose-50 data-[disabled]:text-line-strong';

function Item({
  children,
  onSelect,
  kbd,
  disabled,
  hint,
}: {
  children: ReactNode;
  onSelect?: () => void;
  kbd?: string;
  disabled?: boolean;
  /** Why it is disabled (ERRORS_AND_ALERTS rule 5: disabled actions explain why), in words, inside the item. */
  hint?: string | undefined;
}) {
  return (
    <DropdownMenu.Item className={itemCls} {...(onSelect ? { onSelect } : {})} disabled={disabled}>
      <span className="flex flex-col">
        {children}
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
      </span>
      {kbd && (
        <span className="ml-auto rounded-sm border border-b-2 border-line px-1.5 py-px font-mono text-[11px] text-muted">
          {kbd}
        </span>
      )}
    </DropdownMenu.Item>
  );
}

export function CanvasMenu({
  target,
  open,
  onClose,
}: {
  /** Kept after closing, so focus can still go back to its opener. */
  target: MenuTarget | null;
  open: boolean;
  onClose: () => void;
}) {
  const raw = useNodeActions();
  // Focus goes back to what the menu was opened on (target.opener, captured when it opened), and actions that open
  // a dialog run after that, so the dialog in turn returns focus there (DoD: focus returns to the trigger).
  const opener = target?.opener ?? null;
  const later = (fn: () => void) => () => setTimeout(fn, 0);
  const a: NodeActionsApi = {
    ...raw,
    configure: (id) => later(() => raw.configure(id))(),
    connectFrom: (id) => later(() => raw.connectFrom(id))(),
    addAt: (x, y) => later(() => raw.addAt(x, y))(),
    insertOnEdge: (id, x, y) => later(() => raw.insertOnEdge(id, x, y))(),
  };
  const g = useGraph.getState;
  const rf = useReactFlow();
  const node = target?.kind === 'node' ? g().nodes.find((n) => n.id === target.id) : undefined;
  return (
    <DropdownMenu.Root open={open && !!target} onOpenChange={(o) => !o && onClose()}>
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed size-0"
          style={{ left: target?.x ?? 0, top: target?.y ?? 0 }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={2}
          onCloseAutoFocus={(e) => {
            e.preventDefault(); // never the hidden anchor
            if (opener?.isConnected) opener.focus();
          }}
          aria-label={
            target?.kind === 'node' ? 'Node menu' : target?.kind === 'edge' ? 'Edge menu' : 'Canvas menu'
          }
          className="z-50 w-[240px] rounded-xl border border-line bg-surface p-1.5 shadow-pop"
        >
          {target?.kind === 'node' && node && (
            <>
              <Item kbd="Enter" onSelect={() => a.configure(node.id)}>
                Configure
              </Item>
              <Item disabled hint="Arrives with the engine (next build)">
                Run to here
              </Item>
              <Item kbd="⌘D" onSelect={() => g().duplicate([node.id])}>
                Duplicate
              </Item>
              <Item onSelect={() => g().toggleDisabled([node.id])}>
                {node.disabled ? 'Enable' : 'Disable'}
              </Item>
              {outputsOf(node).length > 0 && <Item onSelect={() => a.connectFrom(node.id)}>Connect to…</Item>}
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <Item kbd="⌫" onSelect={() => a.remove([node.id])}>
                Delete
              </Item>
            </>
          )}
          {target?.kind === 'edge' && (
            <>
              <Item onSelect={() => a.insertOnEdge(target.id, target.x, target.y)}>Insert node…</Item>
              <Item kbd="⌫" onSelect={() => g().removeEdge(target.id)}>
                Delete edge
              </Item>
            </>
          )}
          {target?.kind === 'pane' && (
            <>
              <Item kbd="/" onSelect={() => a.addAt(target.x, target.y)}>
                Add node…
              </Item>
              <Item
                kbd="⌘V"
                disabled={!g().clipboard}
                hint={g().clipboard ? undefined : 'Nothing copied yet'}
                onSelect={() => g().paste()}
              >
                Paste
              </Item>
              <Item onSelect={a.layout}>Auto-layout</Item>
              <Item onSelect={() => void rf.fitView({ duration: 300, maxZoom: 1 })}>Fit view</Item>
              <Item onSelect={() => g().select(g().nodes.map((n) => n.id))}>Select all</Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
