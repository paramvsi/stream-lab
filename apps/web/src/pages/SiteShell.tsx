import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * Site header + footer from boards W07/W08 (the full landing/course chrome is M5).
 * ponytail: only links to pages that exist; Learn, Desktop app and Docs arrive in M5.
 */
export function SiteShell({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex h-16 items-center gap-8 border-b border-line px-8">
        <Link
          to="/new"
          className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em] text-ink no-underline"
        >
          <img src="/logo-mark.svg" width={28} height={28} alt="" />
          stream<span className="text-rose-600">lab</span>
        </Link>
        <nav aria-label="Main" className="flex gap-6 text-[14px] font-medium">
          <Link to="/new" className="text-muted no-underline hover:text-ink [&.active]:text-ink">
            New pipeline
          </Link>
          <Link to="/pipelines" className="text-muted no-underline hover:text-ink [&.active]:text-ink">
            My pipelines
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            {eyebrow && (
              <span className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
                {eyebrow}
              </span>
            )}
            <h1 className="m-0 text-[36px] leading-[1.2] font-bold tracking-[-0.02em]">{title}</h1>
          </div>
          {actions && <div className="flex gap-3">{actions}</div>}
        </div>
        {children}
      </main>
      <footer className="border-t border-line bg-subtle px-8 py-8 text-[13px] text-muted">
        <p className="m-0">
          {/* rose-700: rose-600 on the subtle footer is below AA. */}
          stream<span className="text-rose-700">lab</span> · Learn and run Apache Flink® with your own eyes.
          Free and open source.
        </p>
        <p className="m-0 mt-1">
          Apache Flink and Flink are trademarks of the Apache Software Foundation. Stream Lab is not
          affiliated with the ASF.
        </p>
      </footer>
    </div>
  );
}
