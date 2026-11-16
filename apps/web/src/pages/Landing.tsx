import { CHAPTERS, type Progress } from '@sl/course';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Download, Flag, FlaskConical, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getProgress } from '../storage';
import './landing.css';
import { detectOs, PLATFORMS } from './platforms';
import { SiteShell } from './SiteShell';

const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
const btn =
  'sl-focus inline-flex h-11 items-center gap-2 rounded-lg px-5 text-[15px] font-semibold no-underline';

/** LAND-04: a section rises in once, the first time it is on screen (not on every scroll). */
function Reveal({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // Without IntersectionObserver (old browsers): shown at once.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <section ref={ref} aria-label={label} data-in={seen || undefined} className={`sl-reveal ${className}`}>
      {children}
    </section>
  );
}
const item = (i: number) => ({ '--i': i }) as CSSProperties;

/**
 * LAND-01 the hero pipeline (board W01): events flow from payments through Rules into the 5-minute window, the
 * window fires, alert rows appear. A CSS loop; it pauses when off-screen; reduced motion shows the still frame.
 */
function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return; // keeps playing; nothing else breaks
    const io = new IntersectionObserver((es) => setOnScreen(es.some((e) => e.isIntersecting)));
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const nodes = [
    ['SOURCE', 'payments'],
    ['VALIDATE', 'Rules'],
    ['WINDOW', '5 min tumbling'],
    ['SINK', 'Fraud alerts'],
  ] as const;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A payments pipeline: events flow through Rules into a 5-minute window; when the watermark passes 12:05 the window fires and two fraud alerts come out."
      data-paused={onScreen ? undefined : ''}
      className="sl-hero mx-auto flex w-full max-w-[1080px] flex-col gap-8 rounded-2xl border border-line bg-surface p-5 shadow-pop md:p-10"
    >
      <div className="grid grid-cols-2 gap-3 md:flex md:items-center md:gap-0">
        {nodes.map(([kind, name], i) => (
          <div key={name} className="flex min-w-0 items-center md:flex-1 md:last:flex-none">
            <div
              className={`flex w-full flex-col md:w-[170px] rounded-lg border border-line px-4 py-3 ${kind === 'WINDOW' ? 'sl-hero-fire' : ''}`}
            >
              <span className="font-mono text-[11px] font-semibold text-rose-700">{kind}</span>
              <span className="text-[14px] font-semibold">{name}</span>
            </div>
            {i < nodes.length - 1 && (
              <div className="relative mx-3 hidden h-px flex-1 bg-rose-100 md:block">
                {[0, 0.8, 1.6].map((d) => (
                  <span
                    key={d}
                    className="sl-hero-dot absolute top-[-4px] left-1/2 size-2 rounded-full bg-rose-500"
                    style={{ '--delay': `${d}s` } as CSSProperties}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:gap-10">
        <div className="relative h-12 w-full md:flex-1">
          <div className="absolute top-1/2 right-0 left-0 h-2 -translate-y-1/2 rounded-full bg-rose-50" />
          {[4, 12, 20, 30, 34, 40, 50, 58].map((x, i) => (
            <span
              key={x}
              className={`absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full ${i === 4 ? 'bg-orange-500 ring-2 ring-orange-700' : 'bg-rose-500'}`}
              style={{ left: `${x}%` }}
            />
          ))}
          {[70, 80, 92].map((x) => (
            <span
              key={x}
              className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border border-line-strong bg-surface"
              style={{ left: `${x}%` }}
            />
          ))}
          <div className="sl-hero-wm absolute top-0 bottom-0 left-[64%] border-l-2 border-ink">
            <span className="absolute -top-4 left-1 font-mono text-[11px] whitespace-nowrap">
              WM 12:04:07
            </span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-1.5 md:w-[300px]">
          <span className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Output</span>
          {['12:00–12:05 · c_4471 · 1,940.00', '12:05–12:10 · c_4471 · 12,400.00'].map((r, i) => (
            <span
              key={r}
              className="sl-hero-row flex gap-2 rounded-md bg-subtle px-2 py-1 font-mono text-[12px]"
              style={{ '--delay': `${i * 0.4}s` } as CSSProperties}
            >
              <span className="font-semibold text-rose-700">alert</span>
              {r}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const STEPS: [LucideIcon, string, string][] = [
  [
    FlaskConical,
    'Build',
    'Drag nodes from six colour-coded families. Every edge shows how many events pass.',
  ],
  [Zap, 'Break', 'Inject late, duplicate and malformed events. Watch the dead-letter output fill.'],
  [Flag, 'Understand', "A guided replay highlights each event's path and explains every decision."],
  [Download, 'Ship', 'Export Flink SQL or deploy from the desktop app to a real cluster.'],
];

/**
 * LAND-01..04 the landing (boards W01 new visitor, W01b returning): the animated hero, how it works, Explain this
 * run, the course and the desktop app. A returning learner (a chapter in progress) gets "Continue" instead of the
 * "New" pill.
 */
export function Landing() {
  const [progress, setProgress] = useState<Progress>({});
  // Progress only changes the pill: a storage problem here just means the "new visitor" view.
  useEffect(() => void getProgress().then(setProgress, () => setProgress({})), []);
  const started = CHAPTERS.find((c) => !c.v1 && progress[c.id] === 'started');
  const detected = detectOs(nav.userAgentData?.platform, navigator.userAgent);
  const os = PLATFORMS[detected].name;
  // Board W01: "Windows and Linux" next to "for macOS": the two other platforms.
  const others = (Object.keys(PLATFORMS) as (keyof typeof PLATFORMS)[])
    .filter((o) => o !== detected)
    .map((o) => PLATFORMS[o].name)
    .join(' and ');
  return (
    <SiteShell grid docTitle="Watch Apache Flink® think">
      <div className="flex flex-col items-center gap-5 pt-6 text-center">
        {started ? (
          <Link
            to="/learn/$chapter"
            params={{ chapter: started.id }}
            className="sl-focus flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-[13px] text-rose-700 no-underline"
          >
            <span className="font-semibold">Continue</span>
            Chapter {started.n}: {started.title}
            <span className="font-semibold">Resume</span>
          </Link>
        ) : (
          <Link
            to="/new"
            className="sl-focus flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-[13px] text-rose-700 no-underline"
          >
            New: guided &ldquo;Explain this run&rdquo;
            <span className="font-semibold">Try it</span>
          </Link>
        )}
        <h1 className="m-0 max-w-[820px] text-[40px] leading-[1.05] font-bold tracking-[-0.03em] md:text-[64px]">
          Watch Apache Flink® think, one event at a time.
        </h1>
        <p className="m-0 max-w-[640px] text-[18px] text-muted">
          Build a streaming pipeline in your browser, feed it late and messy data, and let Stream Lab show you
          exactly why every result came out the way it did.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {/* LAND-02: the primary CTA opens the scenario gallery, the secondary the course. */}
          <Link to="/new" className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>
            Start building
          </Link>
          <Link to="/learn" className={`${btn} border border-line text-ink hover:bg-subtle`}>
            Take the course
          </Link>
        </div>
        <p className="m-0 text-[13px] text-muted">
          Free and open source · runs entirely in your browser · no sign-up
        </p>
      </div>
      <Hero />
      <Reveal label="How it works" className="flex flex-col gap-6 pt-16">
        <p className="sl-reveal-item m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
          How it works
        </p>
        <h2 className="sl-reveal-item m-0 text-[32px] font-bold tracking-[-0.02em]" style={item(1)}>
          Build it. Break it. Understand it. Ship it.
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([Icon, t, d], i) => (
            <li
              key={t}
              className="sl-reveal-item flex flex-col gap-2 rounded-xl border border-line p-5"
              style={item(i + 2)}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                <Icon size={18} aria-hidden="true" />
              </span>
              <h3 className="m-0 text-[17px] font-semibold">{t}</h3>
              <p className="m-0 text-[14px] text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal label="Explain this run" className="grid grid-cols-1 items-center gap-10 pt-16 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <p className="sl-reveal-item m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
            Explain this run
          </p>
          <h2 className="sl-reveal-item m-0 text-[32px] font-bold tracking-[-0.02em]" style={item(1)}>
            A guided replay, not a wall of metrics.
          </h2>
          <p className="sl-reveal-item m-0 text-[16px] text-muted" style={item(2)}>
            Step through a run with the path of each event highlighted on the canvas. Stream Lab tells you why
            a window fired, why an event was late, and where it went.
          </p>
          <ul
            className="sl-reveal-item m-0 flex list-none flex-wrap gap-2 p-0 text-[12px] font-medium"
            style={item(3)}
          >
            {['Spotlight on each step', 'Plain-language narration', 'Jump to any event'].map((t, i) => (
              <li
                key={t}
                className={`rounded-md border px-2.5 py-1 ${i === 0 ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-line text-ink'}`}
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div
          aria-hidden="true"
          className="sl-reveal-item flex items-center gap-6 rounded-2xl border border-line bg-subtle p-8"
          style={item(3)}
        >
          <div className="shrink-0 rounded-lg border-2 border-rose-600 bg-surface px-4 py-3 text-[14px] font-semibold whitespace-nowrap">
            Bursts per card
          </div>
          <div className="flex flex-col gap-2 rounded-xl border-t-[3px] border-rose-600 bg-surface p-4 shadow-pop">
            <span className="font-mono text-[11px] font-semibold text-rose-700">STEP 3 OF 5</span>
            <span className="text-[15px] font-semibold">The window fires</span>
            <span className="text-[13px] text-muted">
              The watermark passed 12:05, so the 12:00–12:05 window for card c_4471 is complete: 3 payments,
              1,940.00.
            </span>
            <span className="flex items-center gap-3 pt-1 text-[12px]">
              <span className="text-muted underline">Skip tour</span>
              <span className="ml-auto font-semibold">Back</span>
              <span className="rounded-md bg-rose-600 px-2.5 py-1 font-semibold text-white">Next</span>
            </span>
          </div>
        </div>
      </Reveal>
      <Reveal label="Course" className="flex flex-col gap-6 pt-16">
        <p className="sl-reveal-item m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
          Course
        </p>
        <div className="sl-reveal-item flex flex-wrap items-end justify-between gap-2" style={item(1)}>
          <h2 className="m-0 text-[32px] font-bold tracking-[-0.02em]">
            Ten chapters, each with a live pipeline.
          </h2>
          <Link
            to="/learn"
            className="sl-focus rounded-sm text-[14px] text-rose-700 underline underline-offset-2"
          >
            See all chapters
          </Link>
        </div>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {CHAPTERS.filter((c) => !c.v1).map((c, i) => (
            <li key={c.id} className="sl-reveal-item" style={item(i + 2)}>
              <Link
                to="/learn/$chapter"
                params={{ chapter: c.id }}
                className="sl-focus flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-[15px] font-medium text-ink no-underline hover:bg-subtle"
              >
                <span className="font-mono text-[12px] text-rose-700">{String(c.n).padStart(2, '0')}</span>
                <span className="flex-1">{c.title}</span>
                <ChevronRight size={16} aria-hidden="true" className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal label="Desktop app" className="pt-16">
        <div className="sl-reveal-item flex flex-col gap-4 rounded-2xl border border-line bg-subtle p-8">
          <p className="m-0 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Desktop app</p>
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em]">Same visuals, your real cluster.</h2>
          <p className="m-0 max-w-[520px] text-[15px] text-muted">
            Connect to any Flink cluster from your laptop. History, explanations and safe stop-with-savepoint,
            with no server of ours in between.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/download" className={`${btn} bg-ink text-surface hover:opacity-90`}>
              <Download size={16} aria-hidden="true" />
              Desktop app for {os}
            </Link>
            <Link
              to="/download"
              className="sl-focus rounded-sm text-[14px] text-rose-700 underline underline-offset-2"
            >
              {others}
            </Link>
          </div>
        </div>
      </Reveal>
    </SiteShell>
  );
}
