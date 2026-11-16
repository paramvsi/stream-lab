import { CHAPTERS, nextChapter, type Progress } from '@sl/course';
import { AppError, ErrorBanner } from '@sl/errors';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getProgress } from '../storage';
import { SiteShell } from './SiteShell';

/**
 * LEARN-01 the course (boards W04 new, W04b in progress, W04c completed): ten chapters with their state, and
 * progress "saved in this browser" (IndexedDB). The next chapter to take is highlighted with Start / Continue;
 * done ones say Completed; 7–10 are listed as "Coming in v1".
 */
export function Course() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => {
    getProgress().then(setProgress, (e: unknown) => {
      // Storage blocked: the course still opens, as if new, and says progress is not saved.
      setError(e instanceof AppError ? e : new AppError('STORE-BLOCKED', {}, e));
      setProgress({});
    });
  }, []);
  const open = CHAPTERS.filter((c) => !c.v1);
  const done = progress ? CHAPTERS.filter((c) => progress[c.id] === 'done').length : 0;
  const next = progress ? nextChapter(progress) : undefined;
  return (
    <SiteShell
      narrow
      grid
      eyebrow="Course"
      title="Apache Flink®, hands on"
      lede="Ten chapters. Each one explains a concept, gives you a live pipeline, and ends with a challenge."
    >
      {error && <ErrorBanner error={error} onAction={() => {}} />}
      <section
        aria-label="Your progress"
        className="flex w-[320px] flex-col gap-2 rounded-xl border border-line bg-surface p-5"
      >
        <p className="m-0 text-[13px] text-muted">Your progress</p>
        <p className="m-0 text-[28px] leading-tight font-bold">
          {done} of {CHAPTERS.length}
        </p>
        <div
          role="progressbar"
          aria-label="Chapters done"
          aria-valuemin={0}
          aria-valuemax={CHAPTERS.length}
          aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded-full bg-subtle"
        >
          <div className="h-full bg-rose-600" style={{ width: `${(done / CHAPTERS.length) * 100}%` }} />
        </div>
        <p className="m-0 text-[12px] text-muted">
          {error ? 'Not saved: this browser blocks storage' : 'Saved in this browser'}
        </p>
      </section>
      {/* Done for all six open chapters (W04c): every row says Completed and no row is highlighted. */}
      <ol aria-label="Chapters" className="m-0 flex list-none flex-col gap-3 p-0" aria-busy={!progress}>
        {CHAPTERS.map((c) => {
          const status = progress?.[c.id] ?? 'new';
          const current = next?.id === c.id;
          const num = String(c.n).padStart(2, '0');
          return (
            <li
              key={c.id}
              className={`flex items-center gap-4 rounded-xl border bg-surface px-5 py-4 ${current ? 'border-rose-600' : 'border-line'}`}
            >
              {status === 'done' ? (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-600">
                  <Check size={16} aria-label="Completed" />
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[12px] ${current ? 'bg-rose-600 text-white' : 'border border-line text-muted'}`}
                >
                  {num}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="m-0 text-[16px] font-semibold">
                  {c.v1 ? (
                    c.title
                  ) : (
                    <Link
                      to="/learn/$chapter"
                      params={{ chapter: c.id }}
                      className="sl-focus rounded-sm text-ink no-underline hover:underline"
                    >
                      <span className="sr-only">Chapter {c.n}: </span>
                      {c.title}
                    </Link>
                  )}
                </h2>
                <p className="m-0 text-[13px] text-muted">{c.blurb}</p>
              </div>
              {status === 'done' ? (
                <span className="flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-0.5 text-[12px] font-medium text-ink">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-success-600" />
                  Completed
                </span>
              ) : current ? (
                <Link
                  to="/learn/$chapter"
                  params={{ chapter: c.id }}
                  aria-label={`${status === 'started' ? 'Continue' : 'Start'} chapter ${c.n}`}
                  className="sl-focus rounded-lg bg-rose-600 px-4 py-2 text-[14px] font-semibold text-white no-underline hover:bg-rose-700"
                >
                  {status === 'started' ? 'Continue' : 'Start'}
                </Link>
              ) : (
                <span className="flex items-center gap-3 text-[13px] text-muted">
                  {c.v1 && (
                    <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[12px]">Coming in v1</span>
                  )}
                  {c.minutes !== undefined && <span>{c.minutes} min</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{open.length} chapters are open now.</p>
    </SiteShell>
  );
}
