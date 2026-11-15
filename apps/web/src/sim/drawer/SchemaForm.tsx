import { AppError, present } from '@sl/errors';
import type { Issue, Schema } from '@sl/graph';
import { Button, Field, Input, Select, Textarea } from '@sl/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { newId, useGraph } from '../store';

/**
 * NODE-02: a form generated from the node's zod schema. The zod type picks the control; a few key names pick a
 * richer one (CEL expression, input-field picker, duration). Text commits on blur as one undo step (NODE-07);
 * discrete controls (select, toggle, add/remove) are one step each.
 */

type Zod = z.ZodType & { _zod: { def: { type: string; checks?: { _zod: { def: { check: string } } }[] } } };
const kind = (s: Zod) => s._zod.def.type;
const shapeOf = (s: Zod) => (s as unknown as z.ZodObject).shape as Record<string, Zod>;
const elementOf = (s: Zod) => (s as unknown as z.ZodArray<Zod>).element as Zod;
const optionsOf = (s: Zod) => (s as unknown as z.ZodEnum).options as string[];
const innerOf = (s: Zod) => (s as unknown as z.ZodNullable<Zod>).unwrap() as Zod;

const LABEL: Record<string, string> = {
  expr: 'Expression',
  sizeMs: 'Size',
  slideMs: 'Slide',
  gapMs: 'Gap',
  allowedLatenessMs: 'Allowed lateness',
  outOfOrdernessMs: 'Out-of-orderness',
  idleTimeoutMs: 'Idle timeout',
  ttlMs: 'TTL',
  lowerMs: 'Lower bound',
  upperMs: 'Upper bound',
  keyBy: 'Key by',
  eventTime: 'Event-time field',
  reasonField: 'Reason field',
  retentionMs: 'Retention',
  tagField: 'Source tag field',
  defaultBranch: 'Default branch',
  onMiss: 'On a miss',
  asOf: 'As of event time',
  withinWindow: 'Within each window',
  partitionBy: 'Partition by',
  orderBy: 'Order by',
  desc: 'Largest first',
  n: 'N',
  kind: 'Window type',
  fn: 'Function',
  as: 'Output name',
  format: 'Format',
  table: 'Reference table',
  tableKey: 'Table key',
  rate: 'Events per second',
  count: 'Events',
  keys: 'Distinct keys',
  latePct: 'Late %',
  outOfOrderPct: 'Out of order %',
  duplicatePct: 'Duplicates %',
  badRowsPct: 'Bad rows %',
  seed: 'Seed',
  steps: 'Steps',
  withinMs: 'Within',
  contiguity: 'Contiguity',
  min: 'Min times',
  max: 'Max times',
  schema: 'Fields',
  assignments: 'Fields to set',
  rules: 'Rules',
  routes: 'Routes',
  aggregates: 'Aggregates',
  severity: 'Severity',
  required: 'Required',
  type: 'Type',
  field: 'Field',
  name: 'Name',
  drop: 'Drop fields',
  key: 'Key',
  leftKey: 'Left key',
  rightKey: 'Right key',
  condition: 'Condition',
};
const VALUE: Record<string, string> = {
  tumble: 'Tumbling',
  hop: 'Sliding',
  session: 'Session',
  cumulate: 'Cumulating',
  inner: 'Inner',
  left: 'Left',
  drop: 'Drop',
  pass: 'Pass through',
  reject: 'Reject',
  first: 'First',
  last: 'Last',
  table: 'Table',
  json: 'JSON',
  error: 'Error',
  warning: 'Warning',
  strict: 'Strict',
  relaxed: 'Relaxed',
  string: 'Text',
  number: 'Number',
  boolean: 'True/false',
  timestamp: 'Timestamp',
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX',
};
const labelOf = (k: string) => LABEL[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const CEL = new Set(['expr', 'condition']);
const PICK = new Set(['key', 'eventTime', 'orderBy', 'leftKey', 'rightKey', 'field']);
const PICK_MANY = new Set(['keyBy', 'partitionBy', 'drop', 'key']);
const HIDDEN = new Set(['id']); // stable ids (Route rules) are not user settings

const UNITS = [
  ['h', 3600000],
  ['min', 60000],
  ['s', 1000],
  ['ms', 1],
] as const;

export interface FormCtx {
  nodeId: string;
  config: Record<string, unknown>;
  /** Schema per input port (for field pickers; Join: left/right). */
  inputs: Record<string, Schema>;
  issues: Issue[];
  /** Render a CEL expression editor (NODE-03); falls back to a text area. */
  renderCel?: (p: {
    id: string;
    label: string;
    value: string;
    schema: Schema;
    onLive: (v: string) => void;
    onFocus: () => void;
    onBlur: () => void;
    issue?: Issue | undefined;
  }) => ReactNode;
}

const errorFor = (issues: Issue[], path: string) =>
  issues
    .filter((x) => x.field === path)
    .map((i) => present(new AppError(i.code, i.params)).message)
    .join(' ') || undefined;

function setPath(obj: unknown, path: (string | number)[], value: unknown): unknown {
  if (!path.length) return value;
  const [h, ...rest] = path;
  if (Array.isArray(obj)) return obj.map((x, i) => (i === h ? setPath(x, rest, value) : x));
  return {
    ...(obj as object),
    [h as string]: setPath((obj as Record<string, unknown>)?.[h as string], rest, value),
  };
}

function blank(s: Zod): unknown {
  switch (kind(s)) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'enum':
      return optionsOf(s)[0];
    case 'array':
      return [];
    case 'nullable':
      return null;
    case 'object':
      return Object.fromEntries(
        Object.entries(shapeOf(s)).map(([k, v]) => [k, k === 'id' ? newId('r') : blank(v)]),
      );
    default:
      return undefined;
  }
}

export function SchemaForm({ schema, ctx }: { schema: z.ZodType; ctx: FormCtx }) {
  const g = useGraph.getState;
  // Text-like edits: live (no history) while typing, one step on blur.
  const live = (path: (string | number)[], v: unknown) =>
    g().liveConfig(
      ctx.nodeId,
      setPath(g().nodes.find((n) => n.id === ctx.nodeId)?.config ?? ctx.config, path, v),
    );
  // Discrete edits: one step each.
  const commit = (path: (string | number)[], v: unknown, dropHandles?: string[]) =>
    g().updateConfig(
      ctx.nodeId,
      setPath(g().nodes.find((n) => n.id === ctx.nodeId)?.config ?? ctx.config, path, v),
      dropHandles,
    );
  // Nullable settings: the value before "No …" was ticked, so unticking restores it (audit 9).
  const lastSet = useRef(new Map<string, unknown>());
  const editProps = { onFocus: () => g().beginEdit(), onBlur: () => g().endEdit(ctx.nodeId) };

  const port = (path: (string | number)[]) =>
    path[0] === 'rightKey'
      ? (ctx.inputs['right'] ?? [])
      : path[0] === 'leftKey'
        ? (ctx.inputs['left'] ?? [])
        : (ctx.inputs['main'] ?? []);

  function control(key: string, s: Zod, value: unknown, path: (string | number)[]): ReactNode {
    const p = path.join('.');
    const err = errorFor(ctx.issues, p);
    const t = kind(s);
    const fields = port(path);

    if (t === 'string' && CEL.has(key))
      return (
        <Field key={p} label={labelOf(key)} error={err}>
          {ctx.renderCel ? (
            ctx.renderCel({
              id: `cel-${ctx.nodeId}-${p}`,
              label: labelOf(key),
              value: String(value ?? ''),
              schema: fields,
              onLive: (v) => live(path, v),
              ...editProps,
              issue: ctx.issues.find((i) => i.field === p && i.code.startsWith('CEL-')),
            })
          ) : (
            <Textarea
              className="font-mono"
              rows={2}
              value={String(value ?? '')}
              onChange={(e) => live(path, e.target.value)}
              {...editProps}
            />
          )}
        </Field>
      );
    // A Map assignment names a new output field: free text, not a picker (audit 2).
    if (t === 'string' && PICK.has(key) && fields.length && path[0] !== 'assignments')
      return (
        <Field key={p} label={labelOf(key)} error={err}>
          <Select value={String(value ?? '')} onChange={(e) => commit(path, e.target.value)}>
            <option value="">— none —</option>
            {fields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({VALUE[f.type]})
              </option>
            ))}
            {value && !fields.some((f) => f.name === value) ? (
              <option value={String(value)}>{String(value)} (missing)</option>
            ) : null}
          </Select>
        </Field>
      );
    if (t === 'string')
      return (
        <Field key={p} label={labelOf(key)} error={err}>
          <Input value={String(value ?? '')} onChange={(e) => live(path, e.target.value)} {...editProps} />
        </Field>
      );
    if (t === 'number' && key.endsWith('Ms'))
      return (
        <Duration
          key={p}
          label={labelOf(key)}
          error={err}
          ms={Number(value ?? 0)}
          onLive={(v) => live(path, v)}
          edit={editProps}
        />
      );
    if (t === 'number')
      return (
        <Field key={p} label={labelOf(key)} error={err}>
          <Input
            type="number"
            value={String(value ?? 0)}
            onChange={(e) => live(path, Number(e.target.value))}
            {...editProps}
          />
        </Field>
      );
    if (t === 'boolean')
      return (
        <Field key={p} label={labelOf(key)} error={err}>
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={labelOf(key)}
              className="sl-focus size-4 accent-rose-600"
              checked={Boolean(value)}
              onChange={(e) => commit(path, e.target.checked)}
            />
          </span>
        </Field>
      );
    if (t === 'enum')
      return (
        <EnumControl
          key={p}
          label={labelOf(key)}
          error={err}
          options={optionsOf(s)}
          value={String(value)}
          onPick={(v) => commit(path, v)}
        />
      );
    if (t === 'nullable') {
      const inner = innerOf(s);
      const none = value == null;
      return (
        <div key={p} className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              className="sl-focus size-4 accent-rose-600"
              checked={none}
              onChange={(e) => {
                if (e.target.checked) lastSet.current.set(`${ctx.nodeId}:${p}`, value);
                commit(
                  path,
                  e.target.checked
                    ? null
                    : (lastSet.current.get(`${ctx.nodeId}:${p}`) ??
                        (blank(inner) === 0 ? 60000 : blank(inner))),
                );
              }}
            />
            No {labelOf(key).toLowerCase()}
          </label>
          {!none && control(key, inner, value, path)}
          {none && err && <span className="text-[13px] text-orange-700">{err}</span>}
        </div>
      );
    }
    if (t === 'array' && kind(elementOf(s)) === 'string' && PICK_MANY.has(key))
      return (
        <fieldset key={p} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[13px] font-medium">{labelOf(key)}</legend>
          <div className="flex flex-wrap gap-2">
            {fields.map((f) => {
              const on = (value as string[]).includes(f.name);
              return (
                <label
                  key={f.name}
                  className={`flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-mono text-[12px] ${on ? 'border-rose-600 bg-rose-50 text-rose-700' : 'border-line'}`}
                >
                  <input
                    type="checkbox"
                    className="sl-focus size-3.5 accent-rose-600"
                    checked={on}
                    onChange={() =>
                      commit(
                        path,
                        on
                          ? (value as string[]).filter((x) => x !== f.name)
                          : [...(value as string[]), f.name],
                      )
                    }
                  />
                  {f.name}
                </label>
              );
            })}
            {!fields.length && (
              <span className="text-[13px] text-muted">Connect an input to pick fields.</span>
            )}
          </div>
          {err && <span className="text-[13px] text-danger-600">{err}</span>}
        </fieldset>
      );
    if (t === 'array' && kind(elementOf(s)) === 'object') {
      const el = elementOf(s);
      const rows = (value as Record<string, unknown>[]) ?? [];
      return (
        <fieldset key={p} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[13px] font-medium">{labelOf(key)}</legend>
          {rows.map((row, i) => (
            <div
              key={(row.id as string) ?? i}
              className="flex flex-wrap items-end gap-3 rounded-md border border-line p-3"
            >
              {Object.entries(shapeOf(el))
                .filter(([k]) => !HIDDEN.has(k))
                .map(([k, sub]) => (
                  <div key={k} className="min-w-[140px] flex-1">
                    {control(k, sub, row[k], [...path, i, k])}
                  </div>
                ))}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${labelOf(key).toLowerCase()} ${i + 1}`}
                onClick={() =>
                  commit(
                    path,
                    rows.filter((_, j) => j !== i),
                    // A Route rule is an output port: its edge goes with it.
                    key === 'routes' ? [`route-${String(row.id)}`] : undefined,
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
          {err && <span className="text-[13px] text-danger-600">{err}</span>}
          <Button
            size="sm"
            icon={<Plus size={16} aria-hidden="true" />}
            className="w-fit"
            onClick={() => commit(path, [...rows, blank(el)])}
          >
            Add {singular(labelOf(key))}
          </Button>
        </fieldset>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(shapeOf(schema as Zod)).map(([k, s]) => control(k, s, ctx.config[k], [k]))}
    </div>
  );
}

const singular = (s: string) =>
  s
    .toLowerCase()
    .replace(/ies$/, 'y')
    .replace(/s$/, '')
    .replace(/^fields to set$/, 'field');

function EnumControl({
  label,
  error,
  options,
  value,
  onPick,
}: {
  label: string;
  error?: string | undefined;
  options: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  const id = useId();
  if (options.length > 4)
    return (
      <Field label={label} error={error}>
        <Select value={value} onChange={(e) => onPick(e.target.value)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {VALUE[o] ?? o}
            </option>
          ))}
        </Select>
      </Field>
    );
  // Segmented (board W10-Window): a radio group.
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[13px] font-medium">{label}</legend>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex w-fit gap-0.5 rounded-[9px] border border-line bg-subtle p-0.5"
      >
        {options.map((o) => (
          <label
            key={o}
            className={`cursor-pointer rounded-[7px] px-3 py-1.5 text-[13px] font-medium has-[:focus-visible]:shadow-[0_0_0_2px_var(--sl-color-rose-600)] ${o === value ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(31,20,22,0.08)]' : 'text-muted'}`}
          >
            <input
              type="radio"
              name={id}
              value={o}
              checked={o === value}
              onChange={() => onPick(o)}
              className="sr-only"
            />
            {VALUE[o] ?? o}
          </label>
        ))}
      </div>
      {error && <span className="text-[13px] text-danger-600">{error}</span>}
    </fieldset>
  );
}

function Duration({
  label,
  error,
  ms,
  onLive,
  edit,
}: {
  label: string;
  error?: string | undefined;
  ms: number;
  onLive: (v: number) => void;
  edit: { onFocus: () => void; onBlur: () => void };
}) {
  // The unit is the user's choice, picked once from the value; recomputing it per keystroke changed the
  // meaning of what was typed (audit 3). Negative bounds (Join lower) pick by magnitude.
  const [unit, setUnit] = useState(
    () => (UNITS.find(([, f]) => ms !== 0 && Math.abs(ms) % f === 0) ?? UNITS[2])[0],
  );
  const factor = UNITS.find(([u]) => u === unit)![1];
  // What is in the box while typing: an empty box is not a zero.
  const [draft, setDraft] = useState<string | null>(null);
  const unitId = useId();
  const shown = draft ?? String(ms / factor);
  return (
    <Field label={label} error={error}>
      <span className="flex gap-2">
        <Input
          type="number"
          value={shown}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value !== '') onLive(Number(e.target.value) * factor);
          }}
          onFocus={edit.onFocus}
          onBlur={() => {
            setDraft(null);
            edit.onBlur();
          }}
        />
        <Select
          id={unitId}
          aria-label={`${label} unit`}
          value={unit}
          className="!w-24"
          onChange={(e) => {
            const next = UNITS.find(([u]) => u === e.target.value) ?? UNITS[2];
            setUnit(next[0]);
            onLive((shown === '' ? 0 : Number(shown)) * next[1]);
          }}
          {...edit}
        >
          {UNITS.map(([u]) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
      </span>
    </Field>
  );
}
