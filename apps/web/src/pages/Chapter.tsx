import { CHAPTERS, CONTENT, check, type Progress, type Question } from '@sl/course';
import { AppError, ErrorBanner, present } from '@sl/errors';
import { Banner, Button, Dialog, Tabs } from '@sl/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, Flag, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getProgress, setChapterStatus } from '../storage';
import { WithConcepts } from './Glossary';
import { NotFound } from './NotFound';
import { Sandbox } from './Sandbox';
import { SiteHeader, useDocTitle } from './SiteShell';

/**
 * LEARN-02 a chapter (boards W05 reading, W05c challenge, W05d wrong, W05e pass, W05f complete): the chapter
 * list on the left with the course's progress, the reading in section tabs ending with the challenge.
 * Opening a chapter marks it started; passing its challenge marks it done (LEARN-01) and shows the dialog.
 * The reading is the outline (M5: outlines are reviewed before the full text is written).
 */
export function ChapterPage({ id }: { id: string }) {
  const c = CHAPTERS.find((x) => x.id === id && !x.v1);
  const content = c && CONTENT[c.id];
  const [progress, setProgress] = useState<Progress>({});
  const [error, setError] = useState<AppError | null>(null);
  const [tab, setTab] = useState(content?.sections[0]?.id ?? 'challenge');
  const [complete, setComplete] = useState(false);
  const [at, setAt] = useState<{ qi: number; pick: number | null }>({ qi: 0, pick: null });
  const save = (status: 'started' | 'done') =>
    setChapterStatus(id, status).then(
      () => {
        setProgress((p) => ({ ...p, [id]: status }));
        return true;
      },
      (e: unknown) => {
        setError(e instanceof AppError ? e : new AppError('STORE-BLOCKED', {}, e));
        return false;
      },
    );
  useEffect(() => {
    if (!c) return;
    getProgress().then(
      (p) => {
        setProgress(p);
        if (p[id] !== 'done') void save('started');
      },
      (e: unknown) => setError(e instanceof AppError ? e : new AppError('STORE-BLOCKED', {}, e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per chapter (the route keys the page by id)
  }, []);
  useDocTitle(c ? c.title : 'Page not found'); // this effect runs after NotFound's: it must agree with it
  // A new chapter ("Start chapter N+1", the chapter list) starts at its heading, not on <body>.
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body || !document.activeElement) h1.current?.focus();
  }, []);
  if (!c || !content) return <NotFound />;
  const done = CHAPTERS.filter((x) => progress[x.id] === 'done').length;
  const pct = Math.round((done / CHAPTERS.length) * 100);
  const num = String(c.n).padStart(2, '0');
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />
      <div className="flex flex-1">
        <nav
          aria-label="Chapters"
          className="flex w-[240px] shrink-0 flex-col border-r border-line px-4 py-6"
        >
          <p className="m-0 mb-4 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Chapters</p>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {CHAPTERS.filter((x) => !x.v1).map((x) => (
              <li key={x.id}>
                <Link
                  to="/learn/$chapter"
                  params={{ chapter: x.id }}
                  aria-current={x.id === id ? 'page' : undefined}
                  className={`sl-focus flex items-baseline gap-3 rounded-lg px-2.5 py-2 text-[14px] no-underline ${x.id === id ? 'bg-rose-50 font-semibold text-rose-700' : 'text-ink hover:bg-subtle'}`}
                >
                  {progress[x.id] === 'done' ? (
                    <Check size={14} aria-label="Done" className="shrink-0 text-success-600" />
                  ) : (
                    <span aria-hidden="true" className="w-3.5 shrink-0 font-mono text-[11px] text-muted">
                      {String(x.n).padStart(2, '0')}
                    </span>
                  )}
                  {x.title}
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-auto flex flex-col gap-2 pt-6 text-[13px] text-muted">
            <p className="m-0 flex justify-between">
              <span>Course</span>
              <span className="tabular-nums">{pct}%</span>
            </p>
            <div
              role="progressbar"
              aria-label="Course progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-1.5 overflow-hidden rounded-full bg-subtle"
            >
              <div className="h-full bg-rose-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </nav>
        <main className="flex w-full max-w-[580px] flex-col gap-4 px-8 py-8">
          <p className="m-0 font-mono text-[13px] text-rose-700">
            CHAPTER {num} · {tab === 'challenge' ? 'CHALLENGE' : c.minutes ? `${c.minutes} MIN` : 'READING'}
          </p>
          <h1
            ref={h1}
            tabIndex={-1}
            className="m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em] outline-none"
          >
            {c.title}
          </h1>
          {error && <ErrorBanner error={error} />}
          <Tabs
            pill
            label="Sections"
            value={tab}
            onValueChange={setTab}
            items={[
              ...content.sections.map((s) => ({
                value: s.id,
                label: s.title,
                content: (
                  <div className="flex flex-col gap-3">
                    <Banner severity="info">
                      Draft outline: the full text of this section is being written.
                    </Banner>
                    <ul className="m-0 flex flex-col gap-2 pl-5 text-[16px] leading-relaxed">
                      {s.points.map((pt) => (
                        <li key={pt}>
                          <WithConcepts text={pt} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              })),
              {
                value: 'challenge',
                label: 'Challenge',
                content: (
                  <Challenge
                    questions={content.challenge}
                    at={at}
                    onAt={setAt}
                    // The dialog says "complete" only once it is saved; a failure shows the storage banner.
                    onPass={() => void save('done').then((ok) => ok && setComplete(true))}
                  />
                ),
              },
            ]}
          />
        </main>
        <div className="min-w-0 flex-1 py-8 pr-8">
          <Sandbox chapter={c.id} scenario={content.sandbox} />
        </div>
      </div>
      <Complete open={complete} onOpenChange={setComplete} n={c.n} done={done} />
    </div>
  );
}

/**
 * LEARN-03: one question at a time; a wrong pick says COURSE-WRONG with the hint, a right one "Correct." Each
 * answer is a button (activating it answers): radios would answer on every arrow key. Focus moves to the
 * result's action, and back to the first answer on Reset or the next question. The state lives in the page,
 * so reading a section and coming back keeps the place (Tabs unmount hidden panels).
 */
function Challenge({
  questions,
  at,
  onAt,
  onPass,
}: {
  questions: Question[];
  at: { qi: number; pick: number | null };
  onAt: (a: { qi: number; pick: number | null }) => void;
  onPass: () => void;
}) {
  const { qi, pick } = at;
  const name = useId();
  const first = useRef<HTMLButtonElement>(null);
  const moved = useRef(false); // focus only after a user action, not on mount
  const q = questions[qi]!;
  const result = pick === null ? null : check(q, pick);
  const last = qi === questions.length - 1;
  const wrong = result && !result.pass ? present(new AppError('COURSE-WRONG', { hint: result.hint })) : null;
  // Back to the first answer after Reset or Next question.
  useEffect(() => {
    if (moved.current && pick === null) first.current?.focus();
  }, [qi, pick]);
  // The result's action takes focus when it mounts (a Banner shows its actions a moment after the message,
  // so the live region is announced).
  // Stable: a new function each render would be re-attached, and re-focus, on every re-render.
  const action = useCallback((el: HTMLButtonElement | null) => {
    if (el && moved.current) el.focus();
  }, []);
  const go = (a: { qi: number; pick: number | null }) => {
    moved.current = true;
    onAt(a);
  };
  return (
    <section aria-labelledby={`${name}-t`} className="flex flex-col gap-4 rounded-xl border border-line p-5">
      <div className="flex items-center gap-3">
        <Flag size={18} aria-hidden="true" className="text-rose-600" />
        <h2 id={`${name}-t`} className="m-0 text-[20px] font-semibold">
          Challenge
        </h2>
        <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[12px] text-muted">
          {qi + 1} of {questions.length}
        </span>
      </div>
      <p id={`${name}-q`} className="m-0 text-[16px] font-medium">
        {q.q}
      </p>
      <ul aria-labelledby={`${name}-q`} className="m-0 flex list-none flex-col gap-2 p-0">
        {q.options.map((o, i) => {
          const chosen = pick === i;
          const tone = !chosen
            ? 'border-line hover:bg-subtle'
            : result?.pass
              ? 'border-success-600 bg-success-50'
              : 'border-rose-600 bg-rose-50';
          return (
            <li key={o}>
              <button
                ref={i === 0 ? first : undefined}
                type="button"
                aria-disabled={result?.pass ? true : undefined}
                onClick={() => !result?.pass && go({ qi, pick: i })}
                className={`sl-focus flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-[15px] text-ink ${tone}`}
              >
                {chosen && result ? (
                  result.pass ? (
                    <Check size={16} aria-label="Right:" className="shrink-0 text-success-600" />
                  ) : (
                    <X size={16} aria-label="Wrong:" className="shrink-0 text-rose-700" />
                  )
                ) : (
                  <span
                    aria-hidden="true"
                    className="size-4 shrink-0 rounded-full border border-line-strong"
                  />
                )}
                {o}
              </button>
            </li>
          );
        })}
      </ul>
      {/* Banners are live regions (role=status); keyed by the pick, so a second wrong pick is said again. */}
      {wrong && (
        // COURSE-WRONG, inline under the challenge (catalog). Reset clears the pick.
        <Banner
          key={`w${pick}`}
          severity={wrong.severity}
          actions={
            <Button ref={action} size="sm" onClick={() => go({ qi, pick: null })}>
              Reset
            </Button>
          }
        >
          {wrong.message}
        </Banner>
      )}
      {result?.pass && (
        <Banner
          severity="success"
          actions={
            <Button
              ref={action}
              size="sm"
              variant="primary"
              onClick={() => (last ? onPass() : go({ qi: qi + 1, pick: null }))}
            >
              {last ? 'Finish chapter' : 'Next question'}
            </Button>
          }
        >
          <b>Correct.</b> {q.why}
        </Banner>
      )}
    </section>
  );
}

/** Board W05f: the chapter is done. */
function Complete({
  open,
  onOpenChange,
  n,
  done,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  n: number;
  done: number;
}) {
  const navigate = useNavigate();
  const c = CHAPTERS.find((x) => x.n === n)!;
  const next = CHAPTERS.find((x) => x.n === n + 1 && !x.v1);
  const pct = Math.round((done / CHAPTERS.length) * 100);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Chapter ${n} complete`}
      width={480}
      footer={
        <>
          <Button onClick={() => void navigate({ to: '/learn' })}>Back to course</Button>
          {next && (
            <Button
              variant="primary"
              icon={<ChevronRight size={16} aria-hidden="true" />}
              onClick={() => void navigate({ to: '/learn/$chapter', params: { chapter: next.id } })}
            >
              Start chapter {next.n}
            </Button>
          )}
        </>
      }
    >
      <p className="m-0">{CONTENT[c.id]!.learned}</p>
      <p className="m-0 flex gap-2 text-[12px]">
        <span className="rounded-full bg-success-50 px-2.5 py-0.5 font-medium text-ink">
          {done} of {CHAPTERS.length} done
        </span>
        {c.minutes !== undefined && (
          <span className="rounded-full bg-subtle px-2.5 py-0.5 text-muted">{c.minutes} min</span>
        )}
      </p>
      <p className="m-0 flex justify-between text-[13px] text-muted">
        <span>Course</span>
        <span className="tabular-nums">{pct}%</span>
      </p>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <div className="h-full bg-success-600" style={{ width: `${pct}%` }} />
      </div>
    </Dialog>
  );
}
