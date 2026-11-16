import { Link, useRouterState } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

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
 * The site's header and footer (every web board: W01–W08). The header: Learn, Simulator, Desktop app, Star on
 * GitHub. ponytail: links only to pages that exist — Docs, Changelog, Privacy and Why Stream Lab are added as
 * their pages land.
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
        className={`relative mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-12 md:px-8 ${narrow ? 'max-w-[896px]' : 'max-w-[1120px]'}`}
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
      <footer className="flex flex-wrap justify-between gap-10 border-t border-line px-4 py-12 md:px-16 text-[14px] text-muted">
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
        <nav aria-label="Footer" className="flex flex-wrap gap-10 md:gap-16">
          <div className="flex flex-col gap-2">
            <p className="m-0 mb-1 text-[14px] font-semibold text-ink">Product</p>
            <Link to="/learn" className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Learn
            </Link>
            <Link to="/new" className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Simulator
            </Link>
            <Link to="/download" className="sl-focus rounded-sm text-muted no-underline hover:text-ink">
              Desktop app
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
  // The phone menu behaves like an overlay (DoD): Escape and a click outside close it; so does choosing a link.
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (refocus: boolean) => {
      const d = menu.current;
      if (!d?.open) return;
      d.open = false;
      if (refocus) d.querySelector('summary')?.focus();
    };
    // Escape closes an open menu wherever focus is (Safari does not focus <summary> on click); focus moves to
    // Menu only when it was in the menu or nowhere, never away from a field the user is in.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const a = document.activeElement;
      close(!a || a === document.body || !!menu.current?.contains(a));
    };
    // Tabbing out of the menu closes it too.
    const onFocus = (e: FocusEvent) => {
      if (!menu.current?.contains(e.target as Node)) close(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);
  const onSim = path === '/new' || path === '/pipelines';
  return (
    <header className="relative flex h-[72px] items-center gap-4 border-b border-line px-4 md:px-16">
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
      <nav aria-label="Main" className="mx-auto hidden gap-8 text-[15px] font-medium md:flex">
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
        <Link to="/download" className={navLink}>
          Desktop app
        </Link>
      </nav>
      <a
        href={REPO}
        className="sl-focus ml-auto flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line px-3 text-[14px] font-semibold text-ink no-underline hover:bg-subtle md:ml-0 md:px-4"
      >
        <Star size={16} aria-hidden="true" />
        {/* The words go below md (the icon keeps the link's name). */}
        <span className="sr-only md:not-sr-only">Star on GitHub</span>
      </a>
      {/* Below 768 px (phones, zoomed windows): the same links behind a native disclosure. */}
      <details ref={menu} className="relative md:hidden">
        <summary className="sl-focus flex h-10 cursor-pointer list-none items-center rounded-lg border border-line px-3 text-[14px] font-semibold">
          Menu
        </summary>
        <nav
          aria-label="Main"
          className="absolute right-0 z-50 mt-2 flex w-48 flex-col gap-1 rounded-lg border border-line bg-surface p-2 shadow-pop"
        >
          {(
            [
              ['/learn', 'Learn'],
              ['/new', 'Simulator'],
              ['/download', 'Desktop app'],
              ['/glossary', 'Glossary'],
            ] as const
          ).map(([to, label]) => (
            <Link
              key={to}
              to={to}
              className={`${navLink} rounded-md px-2 py-1.5`}
              onClick={() => menu.current && (menu.current.open = false)}
            >
              {label}
            </Link>
          ))}
        </nav>
      </details>
    </header>
  );
}
