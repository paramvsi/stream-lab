import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLiveFill } from './live';
import { TONE, type Severity } from './tone';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: ReactNode;
  /** What this is + how to fill it (empty), or cause + likely reason (error). */
  children?: ReactNode;
  /** 1–3 actions. */
  actions?: ReactNode;
  /** Omit for a plain empty state; set for a full-page error/warning state. */
  severity?: Severity;
}

/** Board D07c: 52 px tile radius 14 (rose-50 / rose-600), title 18/600, body 14/22 muted max 420. */
export function EmptyState({ icon: Icon, title, children, actions, severity }: EmptyStateProps) {
  const tone = severity ? `${TONE[severity].bg} ${TONE[severity].accent}` : 'bg-rose-50 text-rose-600';
  const filled = useLiveFill();
  const show = filled || !severity;
  return (
    <div
      role={severity ? TONE[severity].role : undefined}
      className="flex flex-col items-center gap-3.5 px-6 py-14 text-center"
    >
      <span className={`flex size-[52px] items-center justify-center rounded-[14px] ${tone}`}>
        <Icon size={24} aria-hidden="true" />
      </span>
      {show && <h3 className="m-0 text-[18px] font-semibold">{title}</h3>}
      {show && children && (
        <p className="m-0 max-w-[420px] text-[14px] leading-[22px] text-muted">{children}</p>
      )}
      {actions && <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>}
    </div>
  );
}
