import { AppError, ErrorBanner, ErrorPage } from '@sl/errors';
import type { Pipeline } from '@sl/graph';
import { Loading, Skeleton } from '@sl/ui';
import { useNavigate } from '@tanstack/react-router';
import { FileQuestion } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  clearRescue,
  getPipeline,
  onSavedElsewhere,
  peekRescue,
  savePipeline,
  unsaved,
  writeRescue,
} from '../storage';
import { useSaveState } from './saveState';
import { newId, useGraph } from './store';
import { copyUploads, deleteUploads } from './uploads';
import { Workspace } from './Workspace';

export const AUTOSAVE_MS = 500;

type Stored = Pipeline & { scenario?: string };

/** Download the open pipeline as JSON (STORE-BLOCKED "Export now"; the full export dialog is EXP-04, M4). */
function exportJson(p: Stored) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'pipeline'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * /sim/:id (SIM-20). IndexedDB is the source of truth on open; memory is used only for a pipeline whose first
 * save failed (`unsaved`). Autosave 500 ms; a real page unload also writes a synchronous rescue copy. Other
 * tabs' saves (SIM-TAB-CONFLICT) and deletes (PIPELINE-DELETED-ELSEWHERE) show banners.
 */
export function WorkspaceRoute({ id }: { id: string }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const base = useRef<Stored | null>(null);
  // While true, store changes come from loading a pipeline, not the user: no autosave.
  const loading = useRef(false);
  const [storeError, setStoreError] = useState<AppError | null>(null);
  const [conflict, setConflict] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const wasDeleted = useRef(false);
  // Shared with the delete handler and "Load newer version", which must cancel a pending autosave
  // (saving it would resurrect a deleted pipeline, or bounce the conflict to the other tab).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Open: IndexedDB first (newer than whatever this tab still holds in memory).
  useEffect(() => {
    let live = true;
    const show = (p: Stored) => {
      base.current = p;
      loading.current = true;
      useGraph.getState().load(p);
      loading.current = false;
    };
    useSaveState.setState({ state: 'saved' }); // the indicator belongs to this pipeline, not the last one
    getPipeline(id).then(
      async (stored) => {
        if (!live) return;
        // The newest of: the stored record, this tab's unsaved copy (a save that failed), and a rescue copy from
        // the last unload. Delete clears all three, so a deleted pipeline is never resurrected.
        const candidates = [stored, unsaved.get(id), peekRescue(id) ?? undefined].filter(
          (x): x is Stored => !!x,
        );
        const newest = candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (!newest) return setStatus('missing');
        show(newest);
        if (newest !== stored) {
          // Not in IndexedDB yet: write it back; until that works, "Not saved" and the banner.
          try {
            await savePipeline(newest);
            unsaved.delete(id);
            clearRescue(id);
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            unsaved.set(id, newest);
            useSaveState.setState({ state: 'error' });
            setStoreError(e);
          }
        } else {
          unsaved.delete(id);
          clearRescue(id);
        }
        if (live) setStatus('ready');
      },
      (e: unknown) => {
        if (!live || !(e instanceof AppError)) throw e;
        setStoreError(e);
        const pending = unsaved.get(id) ?? peekRescue(id) ?? undefined;
        if (pending) {
          useSaveState.setState({ state: 'error' });
          show(pending);
          setStatus('ready');
        } else setStatus('missing');
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  // Autosave: 500 ms after a user change; a real unload also writes the rescue copy.
  useEffect(() => {
    if (status !== 'ready') return;
    if (deleted) {
      useSaveState.setState({ state: 'error' }); // "Not saved", matching the banner
      return;
    }
    const snapshot = (): Stored => {
      const g = useGraph.getState();
      const b = base.current;
      return {
        schemaVersion: 1,
        id,
        name: g.name,
        seed: g.seed,
        data: g.data,
        viewport: b?.viewport ?? { x: 0, y: 0, zoom: 1 },
        ...(b?.scenario ? { scenario: b.scenario } : {}),
        nodes: g.nodes,
        edges: g.edges,
        updatedAt: new Date().toISOString(),
      };
    };
    const save = () => {
      timer.current = null;
      useSaveState.setState({ state: 'saving' });
      const p = snapshot();
      base.current = p;
      savePipeline(p).then(
        () => {
          unsaved.delete(id);
          useSaveState.setState({ state: 'saved' });
          setStoreError(null);
        },
        (e: unknown) => {
          if (!(e instanceof AppError)) throw e;
          // Keep the latest version in memory, so in-app navigation (e.g. "Manage storage") loses nothing.
          unsaved.set(id, p);
          useSaveState.setState({ state: 'error' });
          setStoreError(e);
        },
      );
    };
    const unsub = useGraph.subscribe((s, prev) => {
      if (loading.current) return;
      if (
        s.nodes === prev.nodes &&
        s.edges === prev.edges &&
        s.name === prev.name &&
        s.data === prev.data &&
        s.seed === prev.seed
      )
        return;
      useSaveState.setState({ state: 'saving' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, AUTOSAVE_MS);
    });
    // Real unload only: the async write may not finish, so also keep a synchronous rescue copy.
    const onUnload = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      writeRescue(snapshot());
      save();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', onUnload);
      // In-app navigation: the page stays alive, so the async save completes (no rescue copy needed).
      if (timer.current) {
        clearTimeout(timer.current);
        save();
      }
    };
  }, [id, status, deleted]);

  // Other tabs: a newer save (SIM-TAB-CONFLICT) or a delete (PIPELINE-DELETED-ELSEWHERE).
  useEffect(
    () =>
      onSavedElsewhere(id, (m) => {
        if (m.type === 'deleted') {
          cancelPending(); // never write a deleted pipeline back
          // Nor from this tab's in-memory or rescue copies (only the deleting tab cleared its own).
          unsaved.delete(id);
          clearRescue(id);
          wasDeleted.current = true;
          setDeleted(true);
        } else {
          setDeleted(false); // saved again elsewhere (e.g. Undo of the delete): it exists, and is newer
          // "Not saved" that came from the deleted state goes; a failed save of our own stays.
          if (wasDeleted.current) useSaveState.setState({ state: 'saved' });
          wasDeleted.current = false;
          setConflict(true);
        }
      }),
    [id],
  );

  const showLoaded = (p: Stored) => {
    cancelPending(); // a pending save of the old version would re-trigger the conflict elsewhere
    base.current = p;
    loading.current = true;
    useGraph.getState().load(p);
    loading.current = false;
  };

  if (status === 'loading')
    return (
      <Loading label="Opening pipeline">
        <div className="flex flex-col gap-3 p-8">
          <Skeleton height={56} />
          <Skeleton height={480} />
        </div>
      </Loading>
    );
  if (status === 'missing')
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <h1 className="sr-only">Stream Lab simulator</h1>
        {/* Storage blocked is the likelier cause here; say that rather than only "not found". */}
        {storeError && <ErrorBanner error={storeError} />}
        <ErrorPage
          icon={FileQuestion}
          error={new AppError('PIPELINE-NOT-FOUND')}
          onAction={(label) => void navigate({ to: label === 'My pipelines' ? '/pipelines' : '/new' })}
        />
      </main>
    );

  const current = (): Stored => {
    const g = useGraph.getState();
    return {
      ...(base.current as Stored),
      nodes: g.nodes,
      edges: g.edges,
      name: g.name,
      seed: g.seed,
      data: g.data,
    };
  };
  const storeAction = (label: string) => {
    if (label === 'Export now') exportJson(current());
    // "Manage storage": a page can't open the browser's storage settings; My pipelines is where to free space.
    else if (label === 'Manage storage') void navigate({ to: '/pipelines' });
  };

  return (
    <Workspace
      banners={
        <>
          {storeError && <ErrorBanner error={storeError} onAction={storeAction} />}
          {deleted && (
            <ErrorBanner
              error={new AppError('PIPELINE-DELETED-ELSEWHERE')}
              onAction={(label) => {
                if (label === 'Close') return void navigate({ to: '/pipelines' });
                // "Keep a copy": save what is on screen as a new pipeline and continue there.
                const copy: Stored = {
                  ...current(),
                  id: newId('p'),
                  name: `${useGraph.getState().name} (copy)`,
                  updatedAt: new Date().toISOString(),
                };
                // Rows first (still there: a delete only marks them for a while), then the copy.
                void copyUploads(id, copy.id, Object.keys(copy.data.uploads ?? {}))
                  .then(() => savePipeline(copy))
                  .then(
                    () => void navigate({ to: '/sim/$id', params: { id: copy.id } }),
                    (e: unknown) => {
                      void deleteUploads(copy.id); // a failed copy leaves no rows behind (they are freed)
                      if (!(e instanceof AppError)) throw e;
                      setStoreError(e);
                    },
                  );
              }}
            />
          )}
          {conflict && !deleted && (
            <ErrorBanner
              error={new AppError('SIM-TAB-CONFLICT')}
              onAction={(label) => {
                setConflict(false);
                // Loading must not autosave (that would bounce the banner to the other tab): showLoaded guards it.
                if (label === 'Load newer version') void getPipeline(id).then((p) => p && showLoaded(p));
              }}
            />
          )}
        </>
      }
    />
  );
}
