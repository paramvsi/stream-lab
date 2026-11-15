import { AppError, ErrorBanner, ErrorDialog } from '@sl/errors';
import { parsePipeline, type Pipeline } from '@sl/graph';
import { Button, Dialog, EmptyState, Loading, Skeleton, Table, useToast, type Column } from '@sl/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { Copy, FileUp, Plus, Trash2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../sim/store';
import { deletePipeline, getPipeline, listPipelines, savePipeline, type PipelineMeta } from '../storage';
import { SiteShell } from './SiteShell';

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

  const refresh = useCallback(async () => {
    try {
      setRows(await listPipelines());
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      setStoreError(e);
      setRows([]);
    }
  }, []);
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

  const save = async (p: Pipeline & { scenario?: string }) => {
    try {
      await savePipeline(p);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      setStoreError(e);
    }
    await refresh();
  };

  const duplicate = async (m: PipelineMeta) => {
    const p = await getPipeline(m.id);
    if (!p) return;
    await save({ ...p, id: newId('p'), name: `${p.name} copy`, updatedAt: new Date().toISOString() });
  };

  const remove = async (m: PipelineMeta) => {
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
    // Refresh BEFORE closing the dialog, so its close-focus lands on the updated list (the row it was
    // opened from is gone).
    await refresh();
    setConfirm(null);
    if (p)
      toast({
        severity: 'success',
        message: `Deleted "${m.name}".`,
        action: { label: 'Undo', onClick: () => void save(p) },
      });
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
              <Button variant="danger" onClick={() => void remove(confirm)}>
                Delete pipeline
              </Button>
            </>
          }
        >
          {/* D24: the board's "cannot be undone" clause is dropped — SIM-02 gives delete an Undo. */}
          <p className="m-0">It is stored only in this browser. Export it first if you may want it later.</p>
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
