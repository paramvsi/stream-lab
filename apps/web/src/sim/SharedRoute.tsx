import { AppError, ErrorBanner, ErrorPage } from '@sl/errors';
import type { Pipeline } from '@sl/graph';
import { Banner, Button, Loading, Skeleton } from '@sl/ui';
import { useNavigate } from '@tanstack/react-router';
import { Copy, Link2Off } from 'lucide-react';
import { useEffect, useState } from 'react';
import { decodeShare, downloadJson } from '../share';
import { listRefTables, savePipeline } from '../storage';
import { useRefTables } from './refTables';
import { useSaveState } from './saveState';
import { currentPipeline } from './ShareDialog';
import { newId, useGraph } from './store';
import { saveRows } from './uploads';
import { Workspace } from './Workspace';

/**
 * EXP-04 opening a share link (board W18): the pipeline from the hash, on the canvas but not saved — "Changes are
 * not saved until you make a copy" — with Make a copy. A damaged link is SHARE-BROKEN (full-page state).
 * Uploaded rows that travelled in the link are stored under the id the copy will get, so runs use them and the
 * copy keeps them (until then they are fresh rows the upload cleanup leaves alone).
 */
export function SharedRoute({ data }: { data: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'ready' | AppError>('loading');
  const [id] = useState(() => newId('p'));
  const [saveError, setSaveError] = useState<AppError | null>(null);
  // The header says "Not saved" here, as the banner does (SIM-20), whatever another pipeline's autosave reports.
  useEffect(() => {
    useSaveState.setState({ shared: true });
    return () => useSaveState.setState({ shared: false });
  }, []);
  // DATA-03: the imported tables of this browser, as a workspace loads them (Lookups on them check out).
  useEffect(() => {
    listRefTables().then(
      (ts) => useRefTables.setState({ user: Object.fromEntries(ts.map((t) => [t.name, t])) }),
      (e: unknown) => {
        if (!(e instanceof AppError)) throw e;
        setSaveError(e);
      },
    );
  }, []);
  useEffect(() => {
    let live = true;
    decodeShare(data).then(
      async ({ pipeline, rows }) => {
        // Rows that can not be stored (private browsing, full disk) do not cost the pipeline: it opens
        // without them (its Sources use the generator, DATA-UPLOAD-UNUSED) and the storage banner says why.
        try {
          for (const [source, list] of Object.entries(rows ?? {})) await saveRows(id, source, list);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          if (live) setSaveError(e);
        }
        if (!live) return;
        useGraph.getState().load({ ...pipeline, id });
        setState('ready');
      },
      (e: unknown) => {
        // Anything that is not a whole link reads as SHARE-BROKEN, never a page stuck on "Opening".
        if (live) setState(e instanceof AppError ? e : new AppError('SHARE-BROKEN', {}, e));
      },
    );
    return () => {
      live = false;
    };
  }, [data, id]);

  if (state === 'loading')
    return (
      <Loading label="Opening the shared pipeline">
        <div className="flex flex-col gap-3 p-8">
          <Skeleton height={56} />
          <Skeleton height={480} />
        </div>
      </Loading>
    );
  if (state instanceof AppError)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-bg p-6">
        <h1 className="sr-only">Shared pipeline</h1>
        <ErrorPage icon={Link2Off} error={state} onAction={() => void navigate({ to: '/new' })} />
      </main>
    );

  const copy = async () => {
    setSaveError(null);
    const g = useGraph.getState();
    const p: Pipeline = {
      schemaVersion: 1,
      id,
      name: g.name,
      updatedAt: new Date().toISOString(),
      seed: g.seed,
      nodes: g.nodes,
      edges: g.edges,
      data: g.data,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    try {
      await savePipeline(p);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return setSaveError(e); // what is on screen stays; the banner says why
    }
    void navigate({ to: '/sim/$id', params: { id } });
  };
  return (
    <Workspace
      banners={
        <>
          {saveError && (
            <ErrorBanner
              error={saveError}
              onAction={(label) => {
                if (label === 'Export now') downloadJson(currentPipeline());
                else if (label === 'Manage storage') void navigate({ to: '/pipelines' });
              }}
            />
          )}
          <Banner
            severity="info"
            actions={
              <Button size="sm" icon={<Copy size={16} aria-hidden="true" />} onClick={() => void copy()}>
                Make a copy
              </Button>
            }
          >
            You are viewing a shared pipeline. Changes are not saved until you make a copy.
          </Banner>
        </>
      }
    />
  );
}
