import type { ReactNode } from 'react';

/** A KPI card (boards D05, D08): a named group, so a screen reader hears its label with the value. */
export function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Board D08: a healthy note is green, a failing one red (D08c); always with words, never colour alone. */
  tone?: 'success' | 'error';
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4"
    >
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[26px] font-semibold">{value}</span>
      {note && (
        <span
          className={`text-[12px] ${tone === 'success' ? 'text-success-600' : tone === 'error' ? 'text-danger-600' : 'text-muted'}`}
        >
          {note}
        </span>
      )}
    </div>
  );
}
