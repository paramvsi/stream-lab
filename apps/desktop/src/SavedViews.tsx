import { AppError, present } from '@sl/errors';
import type { JobBucket } from '@sl/flink';
import { Button, Dialog, Field, Input } from '@sl/ui';
import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

/** A saved view of the cross-connection Jobs list (board X18): the search and the chip it was saved with. */
export interface View {
  id: string;
  name: string;
  q: string;
  bucket?: JobBucket;
}

/** VIEW-NAME-REQUIRED / VIEW-NAME-TAKEN (any case, other views only). */
export function nameError(name: string, others: string[]): AppError | null {
  const n = name.trim();
  if (!n) return new AppError('VIEW-NAME-REQUIRED');
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase()))
    return new AppError('VIEW-NAME-TAKEN', { name: n });
  return null;
}

/**
 * Save view (ruled 2026-11-18: a name dialog, like the connection form): the name is checked on blur and on Save;
 * Enter saves. The view keeps the current search and chip.
 */
export function SaveViewDialog({
  taken,
  onSave,
  onClose,
}: {
  taken: string[];
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<AppError | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = () => {
    const e = nameError(name, taken);
    setError(e);
    if (e) return input.current?.focus();
    onSave(name.trim());
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Save view"
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" required error={error ? present(error).message : undefined}>
        <Input
          ref={input}
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name && setError(nameError(name, taken))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            save();
          }}
        />
      </Field>
    </Dialog>
  );
}

/**
 * Edit views (ruled: rename and delete). Changes apply on Done, once every name is valid; Cancel keeps the views as
 * they were.
 */
export function EditViewsDialog({
  views,
  onDone,
  onClose,
}: {
  views: View[];
  onDone: (views: View[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(views);
  const [errors, setErrors] = useState<Record<string, AppError>>({});
  const list = useRef<HTMLUListElement>(null);
  const doneBtn = useRef<HTMLButtonElement>(null);
  const check = (d: View[]) =>
    Object.fromEntries(
      d.flatMap((v) => {
        const e = nameError(
          v.name,
          d.filter((o) => o.id !== v.id).map((o) => o.name),
        );
        return e ? [[v.id, e]] : [];
      }),
    ) as Record<string, AppError>;
  const done = () => {
    const e = check(draft);
    setErrors(e);
    const first = draft.find((v) => e[v.id]);
    if (first) return list.current?.querySelector<HTMLInputElement>(`[data-view="${first.id}"]`)?.focus();
    onDone(draft.map((v) => ({ ...v, name: v.name.trim() })));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit views"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button ref={doneBtn} variant="primary" onClick={done}>
            Done
          </Button>
        </>
      }
    >
      {draft.length === 0 && <p className="m-0 text-[14px] text-muted">No saved views left.</p>}
      <ul ref={list} className="m-0 flex list-none flex-col gap-3 p-0">
        {draft.map((v, i) => {
          const e = errors[v.id];
          return (
            <li key={v.id} className="flex items-end gap-2">
              <Field
                label={`Name of view ${i + 1}`}
                className="flex-1"
                error={e ? present(e).message : undefined}
              >
                <Input
                  data-view={v.id}
                  value={v.name}
                  autoComplete="off"
                  onChange={(ev) =>
                    setDraft((d) => d.map((x) => (x.id === v.id ? { ...x, name: ev.target.value } : x)))
                  }
                />
              </Field>
              <Button
                variant="ghost"
                icon={<Trash2 size={16} aria-hidden="true" />}
                aria-label={`Delete view ${v.name || i + 1}`}
                onClick={() => {
                  // Focus goes to the next row's name, else the previous, else Done.
                  const next = draft[i + 1] ?? draft[i - 1];
                  setDraft((d) => d.filter((x) => x.id !== v.id));
                  setErrors(({ [v.id]: _, ...rest }) => rest);
                  requestAnimationFrame(() =>
                    next
                      ? list.current?.querySelector<HTMLInputElement>(`[data-view="${next.id}"]`)?.focus()
                      : doneBtn.current?.focus(),
                  );
                }}
              />
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
