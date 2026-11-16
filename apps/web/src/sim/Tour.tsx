import { Button, Dialog } from '@sl/ui';
import { CheckCircle2, Compass } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useRun } from './run';
import { useSaveState } from './saveState';
import { useGraph } from './store';

/**
 * EXPL-01 guided tour (boards T01–T06, SIMULATOR.md "Tour"): five steps with a spotlight (box-shadow cutout, rose
 * ring, `sl-spot`) and a coach card (STEP n OF 5 with step dots, Skip tour / Back / Next). It starts by itself on the
 * first visit to the simulator (not in a shared link's view), Esc skips it, it is stored as done once finished or
 * skipped, and the header Tour replays it. Steps 2 and 4 also move on when the user does what they say.
 * It never changes a user's pipeline: step 2 adds the "payments" Source only to an empty one (board T02).
 */
const DONE_KEY = 'sl.tour.done';
type Step = { targets: string[]; title: string; body: string };
const STEPS: Step[] = [
  {
    targets: ['[aria-label="Node library"]'],
    title: 'Your node library',
    body: 'Six families, colour-coded. Drag any node onto the canvas, or press / anywhere to search.',
  },
  {
    targets: ['.react-flow__node'],
    title: 'Drop a Source',
    body: 'Every pipeline starts with a source. We added "payments" for you. Try dragging it a little.',
  },
  {
    targets: ['[aria-label="Run panel"]'],
    title: 'Configure from below',
    body: 'Click any node and its settings open here, with a live preview of its output on the right.',
  },
  {
    // The run pill's panel (top centre); the minimap is top right.
    targets: ['.react-flow__panel.top.center'],
    title: 'Run, step or break it',
    body: 'Run plays all events. Step moves one at a time. Chaos injects late, duplicate and broken events.',
  },
  {
    // Board T05 lights the timeline strip; before a run there is none, so the run panel.
    targets: ['[aria-label="Timeline chart"]', '[aria-label="Run panel"]'],
    title: 'Watch the watermark',
    body: "The black line is the watermark. When it passes the end of a window, that window fires. That's it, you're ready.",
  },
];

/** step: 0–4 the steps, 5 the "You know your way around" card (T06), null closed. */
export const useTour = create<{ step: number | null; added: boolean }>(() => ({ step: null, added: false }));

// Kept in memory too: with storage blocked, a skipped tour stays skipped for this visit.
let doneThisVisit = false;
const done = () => {
  if (doneThisVisit) return true;
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false; // storage blocked: doneThisVisit decides
  }
};
// Focus goes back where it was when the tour opened (DoD), else to the header Tour button.
let opener: HTMLElement | null = null;
const open = (step = 0) => {
  opener =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
  useTour.setState({ step, added: false });
};
const close = () => {
  doneThisVisit = true;
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // storage blocked: remembered for this visit only (doneThisVisit)
  }
  useTour.setState({ step: null });
  const back =
    opener && document.contains(opener) ? opener : document.querySelector<HTMLElement>('[data-tour-button]');
  requestAnimationFrame(() => back?.focus());
};

const find = (targets: string[]) => {
  for (const t of targets) {
    const el = document.querySelector(t);
    if (el) return el;
  }
  return null;
};

/**
 * The rectangle of a step's target, kept current. ponytail: a rAF loop, since the canvas pans and zooms by CSS
 * transform (a ResizeObserver does not see that); it only re-renders when the rectangle changes.
 */
function useTargetRect(targets: string[] | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const key = targets?.join('|') ?? '';
  useLayoutEffect(() => {
    if (!key) return;
    let raf = 0;
    const tick = () => {
      const r = find(key.split('|'))?.getBoundingClientRect() ?? null;
      setRect((old) =>
        old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height
          ? old
          : r,
      );
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [key]);
  return key ? rect : null;
}

export function Tour() {
  const step = useTour((s) => s.step);
  const added = useTour((s) => s.added);
  const titleId = useId();
  const next = useRef<HTMLButtonElement>(null);
  const s = step !== null && step < STEPS.length ? STEPS[step]! : null;
  const rect = useTargetRect(s?.targets ?? null);

  // First visit: start by itself (not in a shared link's view: that is someone else's pipeline).
  useEffect(() => {
    if (!done() && !useSaveState.getState().shared) open(0);
    return () => useTour.setState({ step: null });
  }, []);
  // Step 2: an empty pipeline gets the "payments" Source to drag (T02); dragging the first node moves on.
  useEffect(() => {
    if (step !== 1) return;
    const g = useGraph.getState();
    let first = g.nodes[0];
    if (!first && !useSaveState.getState().shared) {
      const id = g.addNode('Source', { x: 120, y: 160 });
      useGraph.getState().rename(id, 'payments');
      first = useGraph.getState().nodes.find((n) => n.id === id);
      useTour.setState({ added: true });
    }
    const at = first?.position;
    return useGraph.subscribe((st) => {
      const now = st.nodes.find((n) => n.id === first?.id)?.position;
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
  // Esc skips — unless it was for something else that is open (another dialog, a drawer).
  useEffect(() => {
    if (step === null || step >= STEPS.length) return;
    next.current?.focus();
    // Which layers are open is read before any of them handles the key (capture): a drawer that closes on this
    // Escape must still count as open, so one Escape never closes the drawer and the tour.
    let others = false;
    const before = () => {
      others = !!document.querySelector(
        '[role="dialog"]:not([data-tour-card]):not([data-explain-card]), [role="menu"], [role="listbox"]',
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Pressed on the tour card: it is the tour's, whatever else is open (a node drawer, say).
      if ((e.target as Element | null)?.closest?.('[data-tour-card]')) return close();
      if (e.defaultPrevented || others) return;
      close();
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [step]);

  if (step === null) return null;
  if (step >= STEPS.length)
    return (
      // T06: a real dialog (focus trap, Close, sl-pop); closing it in any way finishes the tour.
      <Dialog
        open
        onOpenChange={(o) => !o && close()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        title="You know your way around"
        width={480}
        footer={
          <>
            <Button variant="ghost" onClick={() => open(0)}>
              Replay tour
            </Button>
            <Button variant="primary" onClick={close}>
              Start building
            </Button>
          </>
        }
      >
        <p className="m-0">Three things to try next:</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {[
            'Press Run, then Chaos → + late',
            'Change the window to 1 minute and run again',
            'Click Explain run and follow one card',
          ].map((t) => (
            <li key={t} className="flex items-center gap-2 text-ink">
              <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-success-600" />
              {t}
            </li>
          ))}
        </ul>
      </Dialog>
    );
  const pad = 6;
  const hole = rect && {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
  };
  const W = 320;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Beside a narrow target, centred above a wide one (T03, T05), centred on screen when there is none.
  const card = !hole
    ? { left: (vw - W) / 2, top: vh / 3 }
    : hole.w > vw / 2
      ? { left: Math.max(16, hole.x + hole.w / 2 - W / 2), top: Math.max(16, hole.y - 220) }
      : hole.x + hole.w + W + 32 < vw
        ? { left: hole.x + hole.w + 16, top: Math.max(16, Math.min(hole.y, vh - 260)) }
        : {
            left: Math.max(16, Math.min(hole.x, vw - W - 16)),
            top: Math.min(hole.y + hole.h + 16, vh - 260),
          };
  return (
    <>
      {hole && (
        // The cutout: everything outside the target dims; a rose ring marks it. Moves between targets (300 ms).
        <div
          data-tour-spot
          aria-hidden="true"
          className="sl-spot pointer-events-none fixed z-50 rounded-lg"
          style={{
            left: hole.x,
            top: hole.y,
            width: hole.w,
            height: hole.h,
            boxShadow: '0 0 0 4px var(--sl-color-rose-500), 0 0 0 9999px rgb(31 20 22 / 0.55)',
            transition: 'left 300ms, top 300ms, width 300ms, height 300ms',
          }}
        />
      )}
      {/* Non-modal on purpose: the steps ask the user to act on the page (drag, run). */}
      <div
        data-tour-card
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="fixed z-50 flex flex-col gap-2 rounded-xl bg-surface p-5 shadow-pop"
        style={{ ...card, width: W }}
      >
        <div className="flex items-center">
          <p className="m-0 font-mono text-[12px] font-semibold tracking-wide text-rose-700">
            STEP {step + 1} OF {STEPS.length}
          </p>
          <span className="ml-auto flex gap-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full ${i === step ? 'w-[18px] bg-rose-600' : 'w-1.5 bg-line'}`}
              />
            ))}
          </span>
        </div>
        <h2 id={titleId} className="m-0 text-[17px] font-semibold">
          {s!.title}
        </h2>
        <p className="m-0 text-[14px] text-muted">
          {/* Step 2 says it added the Source only when it did (an empty pipeline, board T02). */}
          {step === 1 && !added
            ? 'Every pipeline starts with a source. Try dragging the first node a little.'
            : s!.body}
        </p>
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            className="sl-focus rounded-sm text-[13px] font-medium text-muted underline-offset-2 hover:underline"
            onClick={close}
          >
            Skip tour
          </button>
          <span className="ml-auto" />
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
      data-tour-button
      size="sm"
      variant="ghost"
      icon={<Compass size={16} aria-hidden="true" />}
      onClick={() => open(0)}
    >
      Tour
    </Button>
  );
}
