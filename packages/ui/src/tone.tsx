import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';

/** The four severities from ERRORS_AND_ALERTS.md §1. No more. */
export type Severity = 'error' | 'warning' | 'info' | 'success';

export const TONE: Record<
  Severity,
  { label: string; icon: LucideIcon; bg: string; accent: string; role: 'alert' | 'status' }
> = {
  error: {
    label: 'Error',
    icon: AlertTriangle,
    bg: 'bg-danger-50',
    accent: 'text-danger-600',
    role: 'alert',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    bg: 'bg-orange-50',
    accent: 'text-orange-700',
    role: 'status',
  },
  info: { label: 'Info', icon: Info, bg: 'bg-rose-50', accent: 'text-rose-700', role: 'status' },
  success: {
    label: 'Success',
    icon: CheckCircle2,
    bg: 'bg-success-50',
    accent: 'text-success-600',
    role: 'status',
  },
};

export function ToneIcon({ severity, size = 18 }: { severity: Severity; size?: number }) {
  const Icon = TONE[severity].icon;
  return <Icon size={size} aria-hidden="true" />;
}
