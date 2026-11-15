import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { useLiveFill } from './live';
import { TONE, ToneIcon, type Severity } from './tone';

export interface BannerProps {
  severity: Severity;
  children: ReactNode;
  /** Max one action group (ERRORS_AND_ALERTS.md §2). */
  actions?: ReactNode;
  /** Only info banners can be dismissed; ignored for other severities. */
  onDismiss?: () => void;
  className?: string;
}

/** Board WX00/X00: tinted strip, icon in the accent colour, ink text, radius 10 → token radius-lg. */
export function Banner({ severity, children, actions, onDismiss, className = '' }: BannerProps) {
  const t = TONE[severity];
  const filled = useLiveFill();
  return (
    <div
      role={t.role}
      className={`flex items-center gap-3 rounded-lg px-4 py-3 text-[14px] leading-5 text-ink ${t.bg} ${className}`}
    >
      <span className={`flex shrink-0 ${t.accent}`}>
        <ToneIcon severity={severity} />
      </span>
      <span className="flex-1">
        {filled && (
          <>
            <span className="sr-only">{t.label}: </span>
            {children}
          </>
        )}
      </span>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      {severity === 'info' && onDismiss && (
        <IconButton aria-label="Dismiss" size="sm" bordered={false} onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
