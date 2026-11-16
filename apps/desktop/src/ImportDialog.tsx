import { AppError, ErrorBanner } from '@sl/errors';
import { importConnections, type Connection, type ImportDuplicate } from '@sl/flink';
import { Button, Dialog, Select, Table } from '@sl/ui';
import { useRef, useState } from 'react';

type Choice = 'skip' | 'replace' | 'both';
type Parsed = {
  file: string;
  connections: Connection[];
  duplicates: ImportDuplicate[];
  dupError: AppError | null;
};

/** A name not in use yet: "name (2)", "name (3)"… (board D03b: "will be renamed"). */
function freeName(name: string, taken: Set<string>) {
  for (let n = 2; ; n++) {
    const next = `${name} (${n})`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/** A connection whose login needs a secret it can not bring along (secrets never travel in files). */
const needsSecret = (c: Connection) =>
  c.auth.type === 'basic' ||
  c.auth.type === 'bearer' ||
  c.headers.some((h) => h.secret) ||
  (c.transport.type === 'proxy' && !!c.transport.user) ||
  (!!c.gateway && !c.gateway.sameLogin && !!c.gateway.auth && c.gateway.auth.type !== 'none');

/**
 * CONN-08 import (board D03b): choose a connections file, see what it holds — new, already here (skip / replace /
 * keep both, CONN-IMPORT-DUP; keep both renames), and which ones need their secret entered after import — then
 * import. A broken file is CONN-IMPORT-INVALID and nothing is imported. Replace keeps the existing connection's id.
 */
export function ImportDialog({
  open,
  onOpenChange,
  existing,
  onImport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: Connection[];
  onImport: (r: { add: Connection[]; replace: Connection[] }) => void;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [choice, setChoice] = useState<Record<number, Choice>>({});
  const imported = useRef(false);
  const close = () => {
    reset();
    onOpenChange(false);
  };
  const reset = () => {
    setParsed(null);
    setError(null);
    setChoice({});
  };
  const read = async (f: File) => {
    reset();
    const r = importConnections(f.name, await f.text(), existing);
    if ('error' in r) setError(r.error);
    else setParsed({ file: f.name, ...r });
  };
  const dupOf = (i: number) => parsed?.duplicates.find((d) => d.index === i);
  const pick = (i: number) => choice[i] ?? 'both';
  const chosen = parsed ? parsed.connections.filter((_, i) => !dupOf(i) || pick(i) !== 'skip') : [];
  const apply = () => {
    if (!parsed) return;
    // Every name that will be in use, before any rename: a renamed copy never takes a later row's name.
    const taken = new Set([
      ...existing.map((c) => c.name.trim().toLowerCase()),
      ...parsed.connections.filter((_, i) => !dupOf(i)).map((c) => c.name.trim().toLowerCase()),
    ]);
    const add: Connection[] = [];
    const replace: Connection[] = [];
    parsed.connections.forEach((c, i) => {
      const d = dupOf(i);
      if (!d) add.push(c);
      else if (pick(i) === 'replace')
        replace.push({ ...c, id: d.existingId, name: existing.find((e) => e.id === d.existingId)!.name });
      else if (pick(i) === 'both') {
        const name = freeName(c.name.trim(), taken);
        taken.add(name.toLowerCase());
        add.push({ ...c, name });
      }
    });
    imported.current = true;
    onImport({ add, replace });
    close();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Import connections"
      width={620}
      onCloseAutoFocus={(e) => {
        if (!imported.current) return; // Cancel / Escape: back to the trigger
        // The screen changed (Welcome → the list) or the list grew: start at its heading.
        imported.current = false;
        e.preventDefault();
        document.querySelector<HTMLElement>('main h1')?.focus();
      }}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            onClick={apply}
            {...(!parsed
              ? { disabledReason: 'Choose a connections file first.' }
              : !chosen.length
                ? { disabledReason: 'Every connection in the file is skipped.' }
                : {})}
          >
            {parsed ? `Import ${chosen.length}` : 'Import'}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">
        {parsed || error ? 'Choose another file' : 'Connections file (.json)'}
        <input
          type="file"
          accept="application/json,.json"
          className="sl-focus text-[14px] file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Cleared, so choosing the same file again (fixed on disk) reads it again.
            e.target.value = '';
            if (f) void read(f);
          }}
        />
      </label>
      {error && <ErrorBanner error={error} />}
      {parsed && (
        <>
          <p className="m-0 font-mono text-[13px] text-muted">{parsed.file}</p>
          {parsed.dupError && <ErrorBanner error={parsed.dupError} />}
          <Table
            label="Connections in the file"
            rows={parsed.connections.map((c, i) => ({ c, i }))}
            rowKey={(r) => r.i}
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (r) => <span className="font-semibold">{r.c.name}</span>,
              },
              {
                key: 'note',
                header: 'Note',
                render: (r) => {
                  const d = dupOf(r.i);
                  const secret = needsSecret(r.c) ? 'Enter its secret after import' : '';
                  if (!d) return secret ? `New · ${secret}` : 'New';
                  return (
                    <span className="flex flex-col gap-1">
                      <Select
                        aria-label={`${r.c.name} already exists`}
                        value={pick(r.i)}
                        onChange={(e) => setChoice((x) => ({ ...x, [r.i]: e.target.value as Choice }))}
                      >
                        <option value="both">Already exists · will be renamed</option>
                        <option value="replace">Already exists · replace it</option>
                        <option value="skip">Already exists · skip</option>
                      </Select>
                      {secret && pick(r.i) !== 'skip' && (
                        <span className="text-[13px] text-muted">{secret}</span>
                      )}
                    </span>
                  );
                },
              },
            ]}
          />
        </>
      )}
    </Dialog>
  );
}
