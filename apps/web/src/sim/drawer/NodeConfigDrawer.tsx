import { configOf, labelOf, spec, type Issue, type Schema } from '@sl/graph';
import { Button, IconButton, Tabs } from '@sl/ui';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Play, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIssues } from '../issues';
import { accent, NodeIcon } from '../look';
import { useGraph } from '../store';
import { CelEditor } from './CelEditor';
import { NODE_DOCS } from './docs';
import { SchemaForm } from './SchemaForm';

const MIN = 200;
const DEFAULT = 360; // SIMULATOR.md: node config 360 px
const COLLAPSED = 40;
const EMPTY: Issue[] = [];

function SchemaTable({ schema, caption }: { schema: Schema; caption: string }) {
  if (!schema.length) return <p className="m-0 text-[14px] text-muted">Nothing connected yet.</p>;
  return (
    <table className="w-full max-w-[640px] border-collapse text-[13px]">
      <caption className="mb-2 text-left text-[13px] font-semibold">{caption}</caption>
      <thead>
        <tr>
          {['Field', 'Type', 'Required'].map((h) => (
            <th
              key={h}
              scope="col"
              className="border-b border-line bg-subtle px-3 py-1.5 text-left text-[12px] font-medium text-muted"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {schema.map((f) => (
          <tr key={f.name}>
            <td className="border-b border-line px-3 py-1.5 font-mono">{f.name}</td>
            <td className="border-b border-line px-3 py-1.5">{f.type}</td>
            <td className="border-b border-line px-3 py-1.5">{f.required ? 'yes' : 'no'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * NODE-01 / NODE-07 bottom drawer (boards W10*): slides up, resizable (200 px – 70 %), collapses to a 40 px bar,
 * Esc closes and focus returns to the node. Tabs: Settings, Input schema, Output preview, Docs.
 */
export function NodeConfigDrawer({
  nodeId,
  inputs,
  outputs,
  onClose,
  preview,
  celEditor,
}: {
  nodeId: string;
  inputs: Record<string, Schema>;
  outputs: Record<string, Schema>;
  onClose: () => void;
  /** Output preview tab content (NODE-04). */
  preview?: ReactNode;
  celEditor?: Parameters<typeof SchemaForm>[0]['ctx']['renderCel'];
}) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId));
  const issues = useIssues((s) => s.byNode[nodeId] ?? EMPTY);
  const [height, setHeight] = useState(DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [name, setName] = useState(node?.label ?? '');
  const panel = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = () => {
      onClose();
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)?.focus(),
      );
    };
  });
  // Max height = 70 % of the canvas, tracked in state (refs must not be read while rendering).
  const [areaH, setAreaH] = useState(900);
  useEffect(() => {
    const area = panel.current?.parentElement;
    if (!area) return;
    const ro = new ResizeObserver(() => setAreaH(area.clientHeight));
    ro.observe(area);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
  }, [nodeId]);

  // Esc closes the drawer even when focus has moved back to the canvas (NODE-07), unless another overlay
  // (menu, dialog, quick-add) owns the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t?.closest('[role="dialog"], [role="menu"], [role="listbox"]') && !panel.current?.contains(t))
        return;
      if (panel.current?.contains(t)) return; // handled by the panel's own onKeyDown
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!node) return null;
  const s = spec(node.type);
  const max = () => Math.round(areaH * 0.7);
  const close = () => {
    onClose();
    // Focus returns to the node it was opened from.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)?.focus(),
    );
  };
  const commitName = () => {
    if (name !== (node.label ?? '')) useGraph.getState().rename(node.id, name);
  };
  const resizeBy = (dy: number) => setHeight((h) => Math.max(MIN, Math.min(max(), h + dy)));

  return (
    <section
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label={`${node.type} settings`}
      className="sl-drawer-b absolute right-0 bottom-0 left-0 z-20 flex flex-col border-t border-line bg-surface shadow-pop"
      style={{ height: collapsed ? COLLAPSED : height, borderTop: `3px solid ${accent(s.category)}` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          commitName();
          close();
        }
      }}
    >
      {/* Resize handle: drag, or arrow keys when focused. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize settings"
          aria-valuemin={MIN}
          aria-valuemax={max()}
          aria-valuenow={height}
          tabIndex={0}
          className="sl-focus absolute -top-1.5 right-0 left-0 h-3 cursor-ns-resize"
          onPointerDown={(e) => {
            const startY = e.clientY;
            const startH = height;
            const move = (ev: PointerEvent) =>
              setHeight(Math.max(MIN, Math.min(max(), startH + startY - ev.clientY)));
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') resizeBy(24);
            else if (e.key === 'ArrowDown') resizeBy(-24);
            else return;
            e.preventDefault();
          }}
        />
      )}
      <header className="flex h-10 shrink-0 items-center gap-2.5 px-4">
        <NodeIcon type={node.type} size={18} color={accent(s.category)} />
        <span
          className="text-[11px] font-semibold tracking-[0.04em] uppercase"
          style={{ color: accent(s.category) }}
        >
          {node.type}
        </span>
        <input
          aria-label="Name"
          placeholder={node.type}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          className="sl-focus min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[15px] font-semibold hover:border-line"
        />
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<Play size={14} aria-hidden="true" />}
            disabledReason="Running arrives with the engine (next build)."
          >
            Run to here
          </Button>
          <IconButton
            aria-label={height >= max() ? 'Restore height' : 'Expand'}
            size="sm"
            bordered={false}
            onClick={() => setHeight((h) => (h >= max() ? DEFAULT : max()))}
          >
            {height >= max() ? (
              <Minimize2 size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            aria-label={collapsed ? 'Expand settings' : 'Collapse settings'}
            aria-expanded={!collapsed}
            size="sm"
            bordered={false}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            aria-label="Close settings"
            size="sm"
            bordered={false}
            onClick={() => {
              commitName();
              close();
            }}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </span>
      </header>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <Tabs
            label={`${labelOf(node)} settings`}
            items={[
              {
                value: 'settings',
                label: 'Settings',
                ...(issues.length ? { count: issues.length } : {}),
                content: (
                  <div className="max-w-[760px]">
                    <SchemaForm
                      schema={s.config}
                      ctx={{
                        nodeId: node.id,
                        config: configOf(node) as Record<string, unknown>,
                        inputs,
                        issues,
                        renderCel: celEditor ?? ((p) => <CelEditor {...p} />),
                      }}
                    />
                  </div>
                ),
              },
              {
                value: 'input',
                label: 'Input schema',
                content: (
                  <div className="flex flex-col gap-5">
                    {s.inputs(configOf(node)).length === 0 ? (
                      <SchemaTable
                        schema={outputs['main'] ?? []}
                        caption="Fields this source produces (edit them in Settings)"
                      />
                    ) : (
                      s
                        .inputs(configOf(node))
                        .map((p) => (
                          <SchemaTable
                            key={p.id}
                            schema={inputs[p.id] ?? []}
                            caption={s.inputs(configOf(node)).length > 1 ? `${p.label} input` : 'Input'}
                          />
                        ))
                    )}
                  </div>
                ),
              },
              {
                value: 'preview',
                label: 'Output preview',
                content: preview ?? <SchemaTable schema={outputs['main'] ?? []} caption="Output fields" />,
              },
              {
                value: 'docs',
                label: 'Docs',
                content: (
                  <div className="flex max-w-[640px] flex-col gap-3 text-[14px] leading-[1.6]">
                    <p className="m-0 font-semibold">{s.description}.</p>
                    {NODE_DOCS[node.type].map((para, i) => (
                      <p key={i} className="m-0 text-muted">
                        {para}
                      </p>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
    </section>
  );
}
