import { Link, useRouterState } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

/** Each page names itself in the tab (WCAG 2.4.2). */
export function useDocTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · Stream Lab` : 'Stream Lab';
  }, [title]);
}

export const REPO = 'https://github.com/paramvsi/stream-lab';

const navLink =
  'sl-focus rounded-sm text-muted no-underline hover:text-ink [&.active]:text-ink [&.active]:font-semibold';

/**
 * The site's header and footer (every web board: W01–W08). The header: Learn, Simulator, Star on GitHub.
 * ponytail: links only to pages that exist — Desktop app (W02), Docs, Changelog, Glossary, Privacy and Why
 * Stream Lab are added as their pages land.
 * `grid`: the background grid with rose nodes, top left (boards W01, W03, W04).
 */
export function SiteShell({
  title,
  eyebrow,
  lede,
  actions,
  narrow = false,
  grid = false,
  docTitle,
  children,
}: {
  title?: string;
  eyebrow?: string;
  lede?: ReactNode;
  actions?: ReactNode;
  /** The course's 832px column (W04, W05) instead of 1120px. */
  narrow?: boolean;
  grid?: boolean;
  /** The tab's title when the page has no `title` (the 404). */
  docTitle?: string;
  children: ReactNode;
}) {
  useDocTitle(docTitle ?? title);
  return (
    <div className="relative flex min-h-screen flex-col bg-surface">
      {grid && (
        <div aria-hidden="true" className="sl-grid pointer-events-none absolute inset-x-0 top-16 h-[420px]" />
      )}
      <SiteHeader />
      <main
        className={`relative mx-auto flex w-full flex-1 flex-col gap-6 px-8 py-12 ${narrow ? 'max-w-[896px]' : 'max-w-[1120px]'}`}
      >
        {title && (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-3">
              {eyebrow && (
                <span className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
                  {eyebrow}
                </span>
              )}
              <h1
                tabIndex={-1}
                className="m-0 text-[36px] leading-[1.2] font-bold tracking-[-0.02em] outline-none"
              >
                {title}
              </h1>
              {lede && <p className="m-0 text-[16px] text-muted">{lede}</p>}
            </div>
            {actions && <div className="flex gap-3">{actions}</div>}
          </div>
        )}
        {children}
      </main>
      <footer className="flex flex-wrap justify-between gap-10 border-t border-line px-16 py-12 text-[14px] text-muted">
        <div className="flex max-w-[460px] flex-col gap-3">
          <p className="m-0 text-[17px] font-semibold text-ink">
            stream<span className="text-rose-700">lab</span>
          </p>
          <p className="m-0">Learn and run Apache Flink® with your own eyes. Free and open source.</p>
          <p className="m-0 text-[12px]">
            Apache Flink and Flink are trademarks of the Apache Software Foundation. Stream Lab is not
            affiliated with the ASF.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-16">
          <div className="flex flex-col gap-2">
            <p className="m-0 mb-1 text-[14px] font-semibold text-ink">Product</p>
            <Link to="/learn" className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Learn
            </Link>
            <Link to="/new" className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Simulator
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            <p className="m-0 mb-1 text-[14px] font-semibold text-ink">Resources</p>
            <Link to="/glossary" className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Glossary
            </Link>
            <a href={REPO} className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              GitHub
            </a>
            <a href={`${REPO}/issues`} className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Report an issue
            </a>
          </div>
        </nav>
      </footer>
    </div>
  );
}

/** The site header (every web board). */
export function SiteHeader() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const onSim = path === '/new' || path === '/pipelines';
  return (
    <header className="relative flex h-[72px] items-center border-b border-line px-16">
      <Link
        to="/"
        className="sl-focus flex items-center gap-2.5 rounded-sm text-[17px] font-semibold tracking-[-0.02em] text-ink no-underline"
      >
        <img src="/logo-mark.svg" width={28} height={28} alt="" />
        {/* One element: the link's gap would split the wordmark. */}
        <span>
          stream<span className="text-rose-600">lab</span>
        </span>
      </Link>
      <nav aria-label="Main" className="mx-auto flex gap-8 text-[15px] font-medium">
        <Link to="/learn" className={navLink}>
          Learn
        </Link>
        {/* The simulator's pages: the gallery and My pipelines. */}
        {/* The simulator's pages are /new and /pipelines (and the workspace, which has its own header). */}
        <Link
          to="/new"
          className={`${navLink} ${onSim ? 'active' : ''}`}
          aria-current={onSim ? 'page' : undefined}
        >
          Simulator
        </Link>
      </nav>
      <a
        href={REPO}
        className="sl-focus flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[14px] font-semibold text-ink no-underline hover:bg-subtle"
      >
        <Star size={16} aria-hidden="true" />
        Star on GitHub
      </a>
    </header>
  );
}
