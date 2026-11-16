import { AppError, ErrorBanner, ErrorPage } from '@sl/errors';
import { Loading } from '@sl/ui';
import { CloudOff } from 'lucide-react';
import { lazy, type ComponentType } from 'react';

const reload = (label: string) => label === 'Reload' && window.location.reload();

/** APP-LOAD-FAILED, as a page (a route) or inline (the chapter sandbox: the reading stays). */
function LoadFailed({ inline, cause }: { inline: boolean; cause: unknown }) {
  const e = new AppError('APP-LOAD-FAILED', {}, cause);
  return inline ? (
    <ErrorBanner error={e} onAction={reload} />
  ) : (
    <div className="py-16">
      <ErrorPage icon={CloudOff} error={e} onAction={reload} />
    </div>
  );
}

/**
 * A page loaded on demand (LAND-06). If its code can not be downloaded (offline, or a new deploy replaced the
 * file), it becomes APP-LOAD-FAILED with Reload — not an error thrown into the site's root (which would leave a
 * dead end), and not a cached rejection (React.lazy keeps whatever the first load gave).
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>, inline = false) {
  return lazy<ComponentType<P>>(() =>
    load().then(
      (C) => ({ default: C }),
      (cause: unknown) => ({ default: () => <LoadFailed inline={inline} cause={cause} /> }),
    ),
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
