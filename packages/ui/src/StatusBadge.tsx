import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { TONE, ToneIcon, type Severity } from './tone';

export type BadgeTone = Severity | 'neutral';

const TONE_CLS: Record<BadgeTone, string> = {
  error: 'bg-danger-50 text-danger-600',
  warning: 'bg-orange-50 text-orange-700',
  info: 'bg-rose-50 text-rose-700',
  // Ink words: success-600 on success-50 is 4.49:1 at 12 px, below AA. The dot keeps the green.
  success: 'bg-success-50 text-ink',
  neutral: 'bg-subtle text-muted',
};

/**
 * Board D07: pill, 12/500, pad 3/10, dot + words. Words are required: never colour alone.
 * `reason` (object-badge placement: "hover = reason") also works by keyboard: the badge becomes a tab stop.
 */
export function StatusBadge({
  tone,
  children,
  reason,
}: {
  tone: BadgeTone;
  children: ReactNode;
  reason?: string;
}) {
  const badge = (
    <span
      tabIndex={reason ? 0 : undefined}
      className={`sl-focus inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-[12px] font-medium whitespace-nowrap ${TONE_CLS[tone]}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-pill ${tone === 'success' ? 'bg-success-600' : 'bg-current'}`}
      />
      {children}
    </span>
  );
  if (!reason) return badge;
  return (
    <Tooltip content={reason} describe>
      {badge}
    </Tooltip>
  );
}

export interface Problem {
  id: string;
  severity: Exclude<Severity, 'success'>;
  /** Where: "Window · Bursts per card", "Ln 5". */
  location: ReactNode;
  message: ReactNode;
  code?: string;
  fix?: { label: string; apply: () => void };
}

/** Panel list placement: count, All/Errors/Warnings filter, rows link back to their source. */
export function ProblemsPanel({
  problems,
  onSelect,
  filter = 'all',
  onFilterChange,
}: {
  problems: Problem[];
  onSelect?: (p: Problem) => void;
  filter?: 'all' | 'error' | 'warning';
  onFilterChange?: (f: 'all' | 'error' | 'warning') => void;
}) {
  const shown = filter === 'all' ? problems : problems.filter((p) => p.severity === filter);
  const n = (s: Severity) => problems.filter((p) => p.severity === s).length;
  const tabs = [
    ['all', `All ${problems.length}`],
    ['error', `Errors ${n('error')}`],
    ['warning', `Warnings ${n('warning')}`],
  ] as const;
  return (
    <section aria-label="Problems" className="flex min-w-0 flex-col">
      {onFilterChange && (
        <div role="group" aria-label="Filter problems" className="flex gap-1 border-b border-line px-3 py-2">
          {tabs.map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filter === v}
              onClick={() => onFilterChange(v)}
              className="sl-focus h-7 rounded-md px-2.5 text-[13px] font-medium text-muted aria-pressed:bg-rose-50 aria-pressed:text-rose-700"
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[14px] text-muted">No problems.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[14px]">
              <span className={`flex shrink-0 ${TONE[p.severity].accent}`}>
                <ToneIcon severity={p.severity} size={16} />
                <span className="sr-only">{TONE[p.severity].label}</span>
              </span>
              <button
                type="button"
                onClick={() => onSelect?.(p)}
                className="sl-focus flex min-w-0 flex-1 items-baseline gap-3 rounded-sm text-left"
              >
                <span className="shrink-0 font-mono text-[12px] text-muted">{p.location}</span>
                <span className="min-w-0 flex-1 truncate">{p.message}</span>
              </button>
              {p.code && <span className="shrink-0 font-mono text-[11px] text-muted">{p.code}</span>}
              {p.fix && (
                <button
                  type="button"
                  onClick={p.fix.apply}
                  className="sl-focus h-7 shrink-0 rounded-md border border-line px-2.5 text-[13px] font-semibold hover:bg-subtle"
                >
                  {p.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
