import { Button } from '@sl/ui';
import { Compass } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useRun } from './run';
import { useGraph } from './store';

/**
 * EXPL-01 guided tour (boards T01–T06, SIMULATOR.md "Tour"): five steps with a spotlight (box-shadow cutout, rose
 * ring, `sl-spot`) and a coach card (step dots, Back / Next / Skip). It starts by itself on the first visit to the
 * simulator, can be skipped (Esc), is stored as done once finished or skipped, and replays from the header.
 * Steps 2 and 4 also move on by themselves when the user does what they say (drags the source, starts a run).
 */
const DONE_KEY = 'sl.tour.done';
const STEPS = [
  {
    target: '[aria-label="Node library"]',
    title: 'Your node library',
    body: 'Six families, colour-coded. Drag any node onto the canvas, or press / anywhere to search.',
  },
  {
    target: '.react-flow__node',
    title: 'Drop a Source',
    body: 'Every pipeline starts with a source. We added "payments" for you. Try dragging it a little.',
  },
  {
    target: '[aria-label="Run panel"]',
    title: 'Configure from below',
    body: 'Click any node and its settings open here, with a live preview of its output on the right.',
  },
  {
    target: '.react-flow__panel.top',
    title: 'Run, step or break it',
    body: 'Run plays all events. Step moves one at a time. Chaos injects late, duplicate and broken events.',
  },
  {
    target: '[aria-label="Run panel"]',
    title: 'Watch the watermark',
    body: "The black line is the watermark. When it passes the end of a window, that window fires. That's it, you're ready.",
  },
] as const;

/** step: 0–4 the steps, 5 the "You know your way around" card (T06), null closed. */
export const useTour = create<{ step: number | null }>(() => ({ step: null }));

const done = () => {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false; // storage blocked: the tour shows (and the flag just isn't kept)
  }
};
const markDone = () => {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // storage blocked: the tour shows again next time, which is harmless
  }
};
const close = () => {
  markDone();
  useTour.setState({ step: null });
};

/** The rectangle of a step's target, kept current (resize, scroll, layout). */
function useTargetRect(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector) return;
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((old) =>
        old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height
          ? old
          : r,
      );
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selector]);
  return selector ? rect : null;
}

export function Tour() {
  const step = useTour((s) => s.step);
  const titleId = useId();
  const next = useRef<HTMLButtonElement>(null);
  const s = step !== null && step < STEPS.length ? STEPS[step]! : null;
  const rect = useTargetRect(s?.target ?? null);

  // First visit: start by itself.
  useEffect(() => {
    if (!done()) useTour.setState({ step: 0 });
    return () => useTour.setState({ step: null });
  }, []);
  // Step 2: there is a Source to drag ("We added payments for you"); dragging it moves on.
  useEffect(() => {
    if (step !== 1) return;
    const g = useGraph.getState();
    let src = g.nodes.find((n) => n.type === 'Source');
    if (!src) {
      const id = g.addNode('Source', { x: 120, y: 160 });
      src = useGraph.getState().nodes.find((n) => n.id === id);
    }
    const at = src?.position;
    return useGraph.subscribe((st) => {
      const now = st.nodes.find((n) => n.id === src?.id)?.position;
      if (at && now && (now.x !== at.x || now.y !== at.y)) useTour.setState({ step: 2 });
    });
  }, [step]);
  // Step 4: starting a run moves on.
  useEffect(() => {
    if (step !== 3) return;
    return useRun.subscribe((r) => {
      if (r.state === 'running') useTour.setState({ step: 4 });
    });
  }, [step]);
  // Esc skips (SIMULATOR.md); focus starts on the main button of each card.
  useEffect(() => {
    if (step === null) return;
    next.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  if (step === null) return null;
  if (step >= STEPS.length)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="sl-spot flex w-[420px] flex-col gap-3 rounded-xl bg-surface p-6 shadow-pop"
        >
          <h2 id={titleId} className="m-0 text-[19px] font-semibold">
            You know your way around
          </h2>
          <p className="m-0 text-[14px] text-muted">Three things to try next:</p>
          <ol className="m-0 flex flex-col gap-1.5 pl-5 text-[14px]">
            <li>Press Run, then Chaos → + late</li>
            <li>Change the window to 1 minute and run again</li>
            <li>Click Explain run and follow one card</li>
          </ol>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => useTour.setState({ step: 0 })}>
              Replay tour
            </Button>
            <Button ref={next} variant="primary" onClick={close}>
              Start building
            </Button>
          </div>
        </div>
      </div>
    );
  const pad = 6;
  const hole = rect && {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
  };
  // The card sits beside the target: right of it when there is room, else above or below.
  const card =
    hole && hole.x + hole.w + 360 < window.innerWidth
      ? { left: hole.x + hole.w + 16, top: Math.max(16, Math.min(hole.y, window.innerHeight - 260)) }
      : hole && hole.y > 280
        ? { left: Math.max(16, Math.min(hole.x, window.innerWidth - 360)), top: hole.y - 236 }
        : {
            left: Math.max(16, Math.min(hole?.x ?? 16, window.innerWidth - 360)),
            top: (hole ? hole.y + hole.h : 0) + 16,
          };
  return (
    <>
      {hole && (
        // The cutout: everything outside the target dims; a rose ring marks the target. Decorative.
        <div
          key={step}
          aria-hidden="true"
          className="sl-spot pointer-events-none fixed z-50 rounded-lg"
          style={{
            left: hole.x,
            top: hole.y,
            width: hole.w,
            height: hole.h,
            boxShadow: '0 0 0 2px var(--sl-color-rose-600), 0 0 0 9999px rgb(31 20 22 / 0.45)',
            transition: 'left 300ms, top 300ms, width 300ms, height 300ms',
          }}
        />
      )}
      <div
        role="dialog"
        aria-labelledby={titleId}
        className="fixed z-50 flex w-[340px] flex-col gap-2 rounded-xl bg-surface p-5 shadow-pop"
        style={card}
      >
        <p className="m-0 font-mono text-[12px] font-semibold tracking-wide text-rose-700">
          STEP {step + 1} OF {STEPS.length}
        </p>
        <h2 id={titleId} className="m-0 text-[17px] font-semibold">
          {s!.title}
        </h2>
        <p className="m-0 text-[14px] text-muted">{s!.body}</p>
        <div className="flex items-center gap-2 pt-2">
          <span className="flex gap-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full ${i === step ? 'bg-rose-600' : 'bg-line-strong'}`}
              />
            ))}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={close}>
            Skip tour
          </Button>
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => useTour.setState({ step: step - 1 })}>
              Back
            </Button>
          )}
          <Button ref={next} size="sm" variant="primary" onClick={() => useTour.setState({ step: step + 1 })}>
            {step === STEPS.length - 1 ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Header "Tour" (SIMULATOR.md): replay at any time. */
export function TourButton() {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Compass size={16} aria-hidden="true" />}
      onClick={() => useTour.setState({ step: 0 })}
    >
      Tour
    </Button>
  );
}
