import { Link } from '@tanstack/react-router';
import { SiteShell } from './SiteShell';

/** LAND-05 the 404 page (board W03): any unknown route, with links to the course and the simulator. */
export function NotFound() {
  return (
    <SiteShell grid>
      <div className="flex flex-col items-center gap-5 py-24 text-center">
        <p className="m-0 font-mono text-[14px] text-orange-700">404 · event arrived after the watermark</p>
        <h1 className="m-0 text-[44px] leading-[1.1] font-bold tracking-[-0.03em]">
          This page was dropped as late data.
        </h1>
        <p className="m-0 text-[17px] text-muted">
          The link may be old, or the page moved. Try one of these instead.
        </p>
        <div className="flex gap-3 pt-2">
          <Link
            to="/learn"
            className="sl-focus rounded-lg bg-rose-600 px-5 py-3 text-[15px] font-semibold text-white no-underline hover:bg-rose-700"
          >
            Go to the course
          </Link>
          <Link
            to="/new"
            className="sl-focus rounded-lg border border-line px-5 py-3 text-[15px] font-semibold text-ink no-underline hover:bg-subtle"
          >
            Open the simulator
          </Link>
        </div>
      </div>
    </SiteShell>
  );
}
