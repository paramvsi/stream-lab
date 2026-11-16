import { AppError, ErrorBanner, ErrorPage } from '@sl/errors';
import { Loading } from '@sl/ui';
import { CloudOff } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { SiteShell } from './SiteShell';

const reload = (label: string) => label === 'Reload' && window.location.reload();

/** APP-LOAD-FAILED, as a page (a route: site header, h1, title) or inline (the chapter sandbox: the reading stays). */
function LoadFailed({ inline, cause }: { inline: boolean; cause: unknown }) {
  const e = new AppError('APP-LOAD-FAILED', {}, cause);
  if (inline) return <ErrorBanner error={e} onAction={reload} />;
  return (
    <SiteShell docTitle="Could not load">
      <h1 className="sr-only">Could not load this page</h1>
      <div className="py-16">
        <ErrorPage icon={CloudOff} error={e} onAction={reload} />
      </div>
    </SiteShell>
  );
}

/** Shown while a page's code downloads (not a blank screen). */
export function PageLoading() {
  return (
    <div className="p-8">
      <Loading label="Loading">
        <p className="m-0 text-[14px] text-muted">Loading…</p>
      </Loading>
    </div>
  );
}

/**
 * A page loaded on demand (LAND-06). Only a successful load is kept: a failed one (offline, or a new deploy
 * replaced the file) shows APP-LOAD-FAILED with Reload, and the next visit tries again — once the connection is
 * back, the page opens without a reload. Not React.lazy: it would keep a failure (or its fallback) for the session,
 * and its Suspense boundary holds the loading state ~300 ms even when the code is already here.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>, inline = false) {
  let loaded: ComponentType<P> | null = null;
  return function LazyPage(props: P) {
    const [state, setState] = useState<{ C?: ComponentType<P>; failed?: { cause: unknown } }>(() =>
      loaded ? { C: loaded } : {},
    );
    useEffect(() => {
      if (state.C) return;
      let live = true;
      load().then(
        (C) => {
          loaded = C;
          if (live) setState({ C });
        },
        (cause: unknown) => live && setState({ failed: { cause } }),
      );
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- one attempt per mount
    }, []);
    if (state.C) return <state.C {...props} />;
    if (state.failed) return <LoadFailed inline={inline} cause={state.failed.cause} />;
    return <PageLoading />;
  };
}
