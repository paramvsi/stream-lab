import type { ReactNode } from 'react';

/** A KPI card (boards D05, D08): a named group, so a screen reader hears its label with the value. */
export function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4"
    >
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[22px] font-semibold">{value}</span>
      {note && <span className="text-[13px] text-muted">{note}</span>}
    </div>
  );
}
