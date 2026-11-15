import { Toast as R } from 'radix-ui';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ToneIcon, type Severity } from './tone';

/** ERRORS_AND_ALERTS.md §2: success/info 4 s, warning 6 s, error 8 s. Hover/focus pauses (Radix). */
export const TOAST_MS: Record<Severity, number> = { success: 4000, info: 4000, warning: 6000, error: 8000 };
export const TOAST_MAX = 3;

export interface ToastInput {
  severity: Severity;
  message: ReactNode;
  /** One action at most. */
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastInput {
  id: number;
  open: boolean;
}

const Ctx = createContext<((t: ToastInput) => void) | null>(null);
let seq = 0;

export function useToast() {
  const push = useContext(Ctx);
  if (!push) throw new Error('useToast() needs <ToastProvider> above it');
  return push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback(
    (t: ToastInput) => setItems((xs) => [...xs, { ...t, id: ++seq, open: true }].slice(-TOAST_MAX)),
    [],
  );
  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <Ctx.Provider value={push}>
      <R.Provider swipeDirection="left" label="Notifications">
        {children}
        {items.map((t) => (
          <ToastView key={t.id} {...t} onOpenChange={(o) => !o && close(t.id)} />
        ))}
        <R.Viewport className="fixed bottom-6 left-6 z-50 m-0 flex w-[420px] max-w-[calc(100vw-48px)] list-none flex-col gap-2 p-0 outline-none" />
      </R.Provider>
    </Ctx.Provider>
  );
}

/** Board W09n: dark ink toast, white icon + text, pop shadow, max 420 px. */
export function ToastView({
  severity,
  message,
  action,
  open = true,
  onOpenChange,
  duration,
}: ToastInput & { open?: boolean; onOpenChange?: (open: boolean) => void; duration?: number }) {
  return (
    <R.Root
      open={open}
      onOpenChange={onOpenChange}
      duration={duration ?? TOAST_MS[severity]}
      // error → assertive announcement; everything else polite (§1 Announce column).
      type={severity === 'error' ? 'foreground' : 'background'}
      className="sl-toast sl-focus flex items-center gap-3 rounded-lg bg-ink px-4 py-3 text-[14px] text-white shadow-pop"
    >
      <span className="flex shrink-0">
        <ToneIcon severity={severity} />
      </span>
      <R.Description className="flex-1">{message}</R.Description>
      {action && (
        <R.Action altText={action.label} asChild>
          <button
            type="button"
            onClick={action.onClick}
            className="sl-focus h-8 rounded-md px-3 text-[13px] font-semibold text-white hover:bg-white/10"
          >
            {action.label}
          </button>
        </R.Action>
      )}
    </R.Root>
  );
}
