import { AppError, ErrorBanner, ErrorDialog } from '@sl/errors';
import { parsePipeline, type Pipeline } from '@sl/graph';
import { Button, Dialog, EmptyState, Loading, Skeleton, Table, useToast, type Column } from '@sl/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { fileSize } from '@sl/engine';
import { Copy, DatabaseZap, FileUp, Plus, Trash2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../sim/store';
import { deletePipeline, getPipeline, listPipelines, savePipeline, type PipelineMeta } from '../storage';
import { SiteShell } from './SiteShell';
import {
  copyUploads,
  deleteUploads,
  purgeDeletedUploads,
  removeUploads,
  restoreUploads,
  uploadBytes,
} from '../sim/uploads';

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (s < 60) return 'just now';
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
};

/** W08 My pipelines: empty, list, import failed (IMPORT-INVALID), delete confirm + Undo (SIM-02, D24). */
export function MyPipelines() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<PipelineMeta[] | null>(null);
  const [storeError, setStoreError] = useState<AppError | null>(null);
  const [importError, setImportError] = useState<AppError | null>(null);
  const [confirm, setConfirm] = useState<PipelineMeta | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const deleting = useRef(false);
  const deletedRow = useRef(false);
  const [busy, setBusy] = useState(false);

  // DATA-04: how much this browser holds for Stream Lab, and each pipeline's uploaded data.
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [freeing, setFreeing] = useState<PipelineMeta | null>(null);
  const [freeingBusy, setFreeingBusy] = useState(false);
  const freedRow = useRef(false);
  const measure = useCallback(async () => {
    try {
      setUploads(await uploadBytes());
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      setStoreError(e); // OPFS unreadable: say so (never a quiet "—" on every row)
    }
    // The estimate is optional (not every browser has it): no line rather than a wrong one.
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    if (est?.quota) setUsage({ used: est.usage ?? 0, quota: est.quota });
  }, []);
  // Every change to the list re-measures (duplicate, delete, undo, import, free).
  const refresh = useCallback(async () => {
    try {
      setRows(await listPipelines());
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      setStoreError(e);
      setRows([]);
    }
    await measure();
  }, [measure]);
  // Free uploads of pipelines deleted longer ago than the grace period (and mark orphans), then measure.
  useEffect(() => {
    void listPipelines()
      // (An unsaved pipeline in this tab's memory is not counted: the entry can be stale after another tab's
      // delete. A fresh first save's rows are protected by the fresh-rows rule.)
      .then((ps) => purgeDeletedUploads(new Set(ps.map((p) => p.id))))
      .catch((e: unknown) => {
        if (!(e instanceof AppError)) throw e;
        setStoreError(e);
      })
      .finally(() => void measure());
  }, [measure]);
  useEffect(() => {
    let live = true;
    listPipelines().then(
      (r) => live && setRows(r),
      (e: unknown) => {
        if (!live) return;
        if (!(e instanceof AppError)) throw e;
        setStoreError(e);
        setRows([]);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  /** True when saved. */
  const save = async (p: Pipeline & { scenario?: string }): Promise<boolean> => {
    let ok = true;
    try {
      await savePipeline(p);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      setStoreError(e);
      ok = false;
    }
    await refresh();
    return ok;
  };

  const duplicate = async (m: PipelineMeta) => {
    const p = await getPipeline(m.id);
    if (!p) return;
    const id = newId('p');
    // The copy keeps its uploads: rows are stored per pipeline id (OPFS). Copy them first, so the copy never
    // appears before its rows exist and a storage failure is said instead of saving a copy without them.
    try {
      await copyUploads(p.id, id, Object.keys(p.data.uploads ?? {}));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      void deleteUploads(id); // rows already copied belong to no pipeline: mark them to be freed
      return setStoreError(e);
    }
    await save({ ...p, id, name: `${p.name} copy`, updatedAt: new Date().toISOString() });
    // The copy was not saved (or can't be read back): free its rows.
    if (!(await getPipeline(id).catch(() => null))) void deleteUploads(id);
  };

  const remove = async (m: PipelineMeta) => {
    if (deleting.current) return; // a double click must not delete (and toast) twice
    deleting.current = true;
    setBusy(true);
    try {
      const p = await getPipeline(m.id);
      try {
        await deletePipeline(m.id);
      } catch (e) {
        // Not deleted: say why, and no "Deleted" toast.
        if (!(e instanceof AppError)) throw e;
        setStoreError(e);
        setConfirm(null);
        return;
      }
      // Refresh BEFORE closing the dialog, so its close-focus lands on the updated list.
      await refresh();
      deletedRow.current = true; // the dialog's trigger row is gone: focus the list instead
      setConfirm(null);
      if (p)
        toast({
          severity: 'success',
          message: `Deleted "${m.name}".`,
          // Undo keeps the uploads too (deleting only marks them; see deleteUploads).
          // Only when the pipeline really came back: else its uploads stay marked and are freed.
          action: {
            label: 'Undo',
            onClick: () =>
              void save(p)
                .then(() => getPipeline(p.id))
                .then((back) => back && restoreUploads(p.id)),
          },
        });
    } catch (e) {
      // Reading the pipeline failed (storage blocked): say so; the button must not stay busy.
      if (!(e instanceof AppError)) throw e;
      setStoreError(e);
      setConfirm(null);
    } finally {
      deleting.current = false;
      setBusy(false);
    }
  };

  const rename = async (m: PipelineMeta, name: string) => {
    const p = await getPipeline(m.id);
    if (p && name.trim() && name !== p.name)
      await save({ ...p, name: name.trim(), updatedAt: new Date().toISOString() });
  };

  const onImport = async (f: File) => {
    const r = parsePipeline(await f.text(), f.name);
    if (!r.ok) return setImportError(new AppError(r.issue.code, r.issue.params));
    // A new id, so importing never overwrites a pipeline already here.
    await save({ ...r.pipeline, id: newId('p'), updatedAt: new Date().toISOString() });
  };

  const columns: Column<PipelineMeta>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <span className="flex items-center gap-2">
          <Link to="/sim/$id" params={{ id: m.id }} className="font-semibold">
            {m.name}
          </Link>
          <RenameButton m={m} onRename={(n) => void rename(m, n)} />
        </span>
      ),
    },
    { key: 'scenario', header: 'Scenario', render: (m) => m.scenario },
    { key: 'size', header: 'Size', mono: true, render: (m) => `${m.nodes} node${m.nodes === 1 ? '' : 's'}` },
    { key: 'edited', header: 'Edited', mono: true, render: (m) => ago(m.updatedAt) },
    {
      key: 'uploads',
      header: 'Uploaded data',
      mono: true,
      align: 'right',
      render: (m) => (uploads[m.id] ? fileSize(uploads[m.id]!) : '—'),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (m) => (
        <span className="inline-flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Duplicate ${m.name}`}
            onClick={() => void duplicate(m)}
          >
            <Copy size={16} aria-hidden="true" />
          </Button>
          {uploads[m.id] ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete uploaded data of ${m.name}`}
              onClick={() => setFreeing(m)}
            >
              <DatabaseZap size={16} aria-hidden="true" />
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" aria-label={`Delete ${m.name}`} onClick={() => setConfirm(m)}>
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  const importButton = (
    <>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onImport(f);
        }}
      />
      <Button icon={<FileUp size={16} aria-hidden="true" />} onClick={() => file.current?.click()}>
        Import JSON
      </Button>
    </>
  );

  return (
    <SiteShell
      eyebrow="Simulator"
      title="My pipelines"
      actions={
        <>
          {importButton}
          <Button
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => void navigate({ to: '/new' })}
          >
            New pipeline
          </Button>
        </>
      }
    >
      <p className="m-0 text-[14px] text-muted">
        Stored only in this browser. Clearing site data removes them; export to keep a copy.
      </p>
      {usage && (
        <p className="m-0 text-[14px] text-muted" aria-live="polite">
          Storage: <span className="font-mono text-ink">{fileSize(usage.used)}</span> used of{' '}
          <span className="font-mono">{fileSize(usage.quota)}</span> this browser gives Stream Lab
          {Object.keys(uploads).length > 0 && (
            <>
              ; uploaded data:{' '}
              <span className="font-mono text-ink">
                {fileSize(Object.values(uploads).reduce((a, b) => a + b, 0))}
              </span>
            </>
          )}
          .
        </p>
      )}
      {storeError && <ErrorBanner error={storeError} />}
      {rows === null ? (
        <Loading label="Loading pipelines">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} />
          ))}
        </Loading>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No saved pipelines yet"
          actions={
            <>
              <Button variant="primary" onClick={() => void navigate({ to: '/new' })}>
                New pipeline
              </Button>
              <Button onClick={() => file.current?.click()}>Import JSON</Button>
            </>
          }
        >
          Pipelines are saved in this browser as you build them. Start one, or import a JSON file.
        </EmptyState>
      ) : (
        <Table label="My pipelines" columns={columns} rows={rows} rowKey={(m) => m.id} />
      )}

      {confirm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          severity="warning"
          title={`Delete "${confirm.name}"?`}
          onCloseAutoFocus={(e) => {
            // Cancel/Escape: default (back to this row's Delete button). After a delete: the list.
            if (!deletedRow.current) return;
            deletedRow.current = false;
            e.preventDefault();
            (
              document.querySelector<HTMLElement>('table[aria-label="My pipelines"] tbody a') ??
              document.querySelector<HTMLElement>('main h1')
            )?.focus();
          }}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove(confirm)}>
                Delete pipeline
              </Button>
            </>
          }
        >
          {/* D24: the board's "cannot be undone" clause is dropped — SIM-02 gives delete an Undo. */}
          <p className="m-0">It is stored only in this browser. Export it first if you may want it later.</p>
        </Dialog>
      )}
      {freeing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setFreeing(null)}
          severity="warning"
          title={`Delete uploaded data of "${freeing.name}"?`}
          onCloseAutoFocus={(e) => {
            // After a delete the row's button is gone: focus the pipeline's link instead (Cancel: default).
            if (!freedRow.current) return;
            freedRow.current = false;
            e.preventDefault();
            (
              document.querySelector<HTMLElement>('table[aria-label="My pipelines"] tbody a') ??
              document.querySelector<HTMLElement>('main h1')
            )?.focus();
          }}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFreeing(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={freeingBusy}
                onClick={async () => {
                  if (freeingBusy) return; // a double click deletes (and toasts) once
                  setFreeingBusy(true);
                  const m = freeing;
                  try {
                    // The pipeline stops claiming the rows first; then they are freed. If freeing fails, the
                    // pipeline claims them again (nothing changed for the user but the banner).
                    let p: Awaited<ReturnType<typeof getPipeline>>;
                    try {
                      p = await getPipeline(m.id);
                    } catch (e) {
                      if (!(e instanceof AppError)) throw e;
                      return setStoreError(e);
                    }
                    if (p && !(await save({ ...p, data: { ...p.data, uploads: {} } }))) return;
                    try {
                      await removeUploads(m.id);
                    } catch (e) {
                      // Claim the rows again; if even that fails, its storage error is the one to show.
                      if (p && !(await save(p))) return;
                      const reason =
                        (e as { name?: string })?.name === 'NoModificationAllowedError'
                          ? 'another tab is using it'
                          : 'the browser refused';
                      setStoreError(new AppError('DATA-DELETE-FAILED', { name: m.name, reason }, e));
                      return;
                    }
                    freedRow.current = true;
                    toast({ severity: 'success', message: `Uploaded data of "${m.name}" deleted.` });
                  } finally {
                    setFreeingBusy(false);
                    setFreeing(null);
                    await measure();
                  }
                }}
              >
                Delete uploaded data
              </Button>
            </>
          }
        >
          <p className="m-0">
            The pipeline stays; its Sources go back to the generator. The uploaded rows can not be brought
            back: upload the files again to use them.
          </p>
        </Dialog>
      )}
      {importError && (
        <ErrorDialog
          open
          onOpenChange={(o) => !o && setImportError(null)}
          error={importError}
          onAction={(label) => {
            setImportError(null);
            if (label === 'Choose another') file.current?.click();
          }}
        />
      )}
    </SiteShell>
  );
}

function RenameButton({ m, onRename }: { m: PipelineMeta; onRename: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(m.name);
  return (
    <>
      <Button size="sm" variant="ghost" aria-label={`Rename ${m.name}`} onClick={() => setOpen(true)}>
        Rename
      </Button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          title={`Rename "${m.name}"`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabledReason={name.trim() ? undefined : 'Enter a name.'}
                onClick={() => {
                  onRename(name);
                  setOpen(false);
                }}
              >
                Rename
              </Button>
            </>
          }
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sl-focus h-10 rounded-md border border-line-strong px-3 text-[14px] font-normal"
            />
          </label>
        </Dialog>
      )}
    </>
  );
}
