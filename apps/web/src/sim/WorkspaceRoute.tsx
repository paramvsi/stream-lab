import { AppError, ErrorBanner, ErrorPage } from '@sl/errors';
import type { Pipeline } from '@sl/graph';
import { Loading, Skeleton } from '@sl/ui';
import { useNavigate } from '@tanstack/react-router';
import { FileQuestion } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getPipeline, onSavedElsewhere, savePipeline, takeRescue, writeRescue } from '../storage';
import { useSaveState } from './saveState';
import { useGraph } from './store';
import { Workspace } from './Workspace';

export const AUTOSAVE_MS = 500;

type Stored = Pipeline & { scenario?: string };

/** /sim/:id — load, autosave (500 ms + on unload), storage banners and the two-tab conflict (SIM-20). */
export function WorkspaceRoute({ id }: { id: string }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(() =>
    useGraph.getState().pipelineId === id ? 'ready' : 'loading',
  );
  const base = useRef<Stored | null>(null);
  const [storeError, setStoreError] = useState<AppError | null>(null);
  const [conflict, setConflict] = useState(false);

  // Load from IndexedDB unless the gallery already put it in memory.
  useEffect(() => {
    let live = true;
    getPipeline(id).then(
      (stored) => {
        if (!live) return;
        // A rescue copy written during the last unload wins when newer; write it back to IndexedDB.
        const rescue = takeRescue(id);
        const p = rescue && (!stored || rescue.updatedAt > stored.updatedAt) ? rescue : stored;
        if (p && p === rescue) void savePipeline(p).catch(() => undefined);
        if (p) {
          base.current = p;
          if (useGraph.getState().pipelineId !== id) useGraph.getState().load(p);
          setStatus('ready');
        } else if (useGraph.getState().pipelineId === id) {
          setStatus('ready'); // in memory only (storage failed when it was created)
        } else setStatus('missing');
      },
      (e: unknown) => {
        if (!live || !(e instanceof AppError)) throw e;
        setStoreError(e);
        setStatus(useGraph.getState().pipelineId === id ? 'ready' : 'missing');
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  // Autosave: debounce 500 ms after the graph or name changes; flush on unload.
  useEffect(() => {
    if (status !== 'ready') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const snapshot = (): Stored => {
      const g = useGraph.getState();
      const b = base.current;
      return {
        schemaVersion: 1,
        id,
        name: g.name,
        seed: b?.seed ?? 42,
        data: b?.data ?? { refTables: [] },
        viewport: b?.viewport ?? { x: 0, y: 0, zoom: 1 },
        ...(b?.scenario ? { scenario: b.scenario } : {}),
        nodes: g.nodes,
        edges: g.edges,
        updatedAt: new Date().toISOString(),
      };
    };
    const save = () => {
      timer = null;
      useSaveState.setState({ state: 'saving' });
      const p = snapshot();
      base.current = p;
      savePipeline(p).then(
        () => {
          useSaveState.setState({ state: 'saved' });
          setStoreError(null);
        },
        (e: unknown) => {
          if (!(e instanceof AppError)) throw e;
          useSaveState.setState({ state: 'error' });
          setStoreError(e);
        },
      );
    };
    const unsub = useGraph.subscribe((s, prev) => {
      if (s.nodes === prev.nodes && s.edges === prev.edges && s.name === prev.name) return;
      useSaveState.setState({ state: 'saving' });
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, AUTOSAVE_MS);
    });
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        writeRescue(snapshot()); // synchronous: survives the unload even if the async write below does not
        save();
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      unsub();
      flush();
      window.removeEventListener('beforeunload', flush);
    };
  }, [id, status]);

  // SIM-TAB-CONFLICT: another tab saved this pipeline.
  useEffect(() => onSavedElsewhere(id, () => setConflict(true)), [id]);

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
      <main className="flex min-h-screen items-center justify-center">
        <h1 className="sr-only">Stream Lab simulator</h1>
        <ErrorPage
          icon={FileQuestion}
          error={new AppError('PIPELINE-NOT-FOUND')}
          onAction={(label) => void navigate({ to: label === 'My pipelines' ? '/pipelines' : '/new' })}
        />
      </main>
    );

  return (
    <Workspace
      banners={
        <>
          {storeError && <ErrorBanner error={storeError} />}
          {conflict && (
            <ErrorBanner
              error={new AppError('SIM-TAB-CONFLICT')}
              onAction={(label) => {
                setConflict(false);
                if (label === 'Load newer version')
                  void getPipeline(id).then((p) => {
                    if (!p) return;
                    base.current = p;
                    useGraph.getState().load(p);
                  });
              }}
            />
          )}
        </>
      }
    />
  );
}
