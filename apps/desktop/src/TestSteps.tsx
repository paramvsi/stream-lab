import { ErrorBanner, present } from '@sl/errors';
import { STEPS, type StepId, type StepResult, type TestOutcome } from '@sl/flink';
import { CheckCircle2, Circle, Info, Loader2, MinusCircle, TriangleAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

const STATUS: Record<StepResult['status'] | 'running' | 'waiting', { word: string; icon: ReactNode }> = {
  pass: { word: 'Passed', icon: <CheckCircle2 size={16} aria-hidden="true" className="text-success-600" /> },
  warn: { word: 'Warning', icon: <TriangleAlert size={16} aria-hidden="true" className="text-orange-700" /> },
  info: { word: 'Note', icon: <Info size={16} aria-hidden="true" className="text-rose-700" /> },
  fail: { word: 'Failed', icon: <XCircle size={16} aria-hidden="true" className="text-danger-600" /> },
  skip: { word: 'Skipped', icon: <MinusCircle size={16} aria-hidden="true" className="text-muted" /> },
  running: {
    word: 'Checking…',
    icon: (
      <Loader2
        size={16}
        aria-hidden="true"
        className="animate-spin text-rose-600 motion-reduce:animate-none"
      />
    ),
  },
  waiting: { word: 'Waiting', icon: <Circle size={16} aria-hidden="true" className="text-muted" /> },
};

/**
 * CONN-05 / boards D02d (testing), D02e (pass), D02f (fail), C04 (each check): the seven checks of
 * testConnection(), each with an icon and words (never colour alone) and its detail or catalog message; the
 * outcome is said once in a live region. ponytail: the step names are testConnection's (the boards word them
 * a little differently: MORNING); no "Save as read-only" yet (C04, when Write access warns).
 */
export function TestSteps({
  results,
  running,
  outcome,
  onAction,
}: {
  results: Partial<Record<StepId, StepResult>>;
  running: boolean;
  outcome: TestOutcome | null;
  onAction: (label: string) => void;
}) {
  const current = running ? STEPS.find((s) => !results[s.id])?.id : undefined;
  return (
    <section aria-labelledby="test-heading" className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h2 id="test-heading" className="m-0 text-[14px] font-semibold">
        Test connection
      </h2>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {STEPS.map((s) => {
          const r = results[s.id];
          const st = STATUS[r?.status ?? (s.id === current ? 'running' : 'waiting')];
          // A failed step's message is in the banner below (with Copy details); other steps show theirs here.
          const note = r?.error && r.status !== 'fail' ? present(r.error).message : r?.detail;
          return (
            <li key={s.id} className="flex items-start gap-3">
              <span className="mt-0.5">{st.icon}</span>
              <span className="flex flex-col">
                <span className="text-[14px] font-medium">
                  {s.label} <span className="font-normal text-muted">· {st.word}</span>
                </span>
                {note && <span className="text-[13px] text-muted">{note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" className="m-0 text-[14px] font-medium">
        {outcome?.result === 'pass' ? 'All checks passed. Ready to save.' : ''}
      </p>
      {/* A failure or a partial pass: the catalog message with its actions (Copy details, Save as read-only…). */}
      {outcome && outcome.result !== 'pass' && <ErrorBanner error={outcome.error} onAction={onAction} />}
    </section>
  );
}
