import { Banner, Button, Dialog, EmptyState, useToast, useToastOptional, type Problem } from '@sl/ui';
import type { LucideIcon } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppError, copyDetails, present, type Presented } from './core';

/** App version for "Copy details". Apps set it once at startup. */
export const errorsConfig = { appVersion: '0.0.0', flinkVersion: undefined as string | undefined };

type OnAction = (label: string, e: AppError) => void;

/** Runs a catalog action. "Copy details" is built in (with feedback); the rest go to `onAction`. */
function useRunAction(onAction?: OnAction) {
  const toast = useToastOptional();
  return (label: string, e: AppError) => {
    if (label !== 'Copy details') return onAction?.(label, e);
    const failed = () => {
      const p = present(new AppError('COPY-FAILED'));
      toast?.({ severity: p.severity, message: p.message });
    };
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip) return failed();
    let text: string;
    try {
      text = copyDetails(e, errorsConfig);
    } catch {
      // Unserializable detail (circular cause, BigInt): say so instead of throwing out of the click handler.
      return failed();
    }
    clip.writeText(text).then(() => toast?.({ severity: 'success', message: 'Details copied' }), failed);
  };
}

function Actions({
  p,
  e,
  onAction,
  max,
}: {
  p: Presented;
  e: AppError;
  onAction?: OnAction | undefined;
  max?: number;
}) {
  const run = useRunAction(onAction);
  // Only actions that do something: "Copy details" is built in; the rest need an onAction handler.
  const labels = p.actions.filter((l) => l === 'Copy details' || onAction).slice(0, max);
  return labels.map((l, i) => (
    <Button
      key={l}
      size="sm"
      variant={i === 0 && l !== 'Copy details' ? 'secondary' : 'ghost'}
      onClick={() => run(l, e)}
    >
      {l}
    </Button>
  ));
}

/** Field / inline placement: `<Field error={<FieldError error={e} />}>`. Field supplies the id, icon and styling. */
export function FieldError({ error }: { error: AppError }) {
  return <>{present(error).message}</>;
}

/** Banner placement. Info banners can be dismissed. */
export function ErrorBanner({
  error,
  onAction,
  onDismiss,
}: {
  error: AppError;
  onAction?: OnAction;
  onDismiss?: () => void;
}) {
  const p = present(error);
  return (
    <Banner
      severity={p.severity}
      {...(onDismiss ? { onDismiss } : {})}
      actions={p.actions.length ? <Actions p={p} e={error} onAction={onAction} /> : undefined}
    >
      {p.message}
    </Banner>
  );
}

/** Toast placement: `const toastError = useErrorToast(); toastError(e)`. One action max. */
export function useErrorToast(onAction?: OnAction) {
  const toast = useToast();
  const run = useRunAction(onAction);
  return (error: AppError) => {
    const p = present(error);
    const first = p.actions[0];
    toast({
      severity: p.severity,
      message: p.message,
      ...(first ? { action: { label: first, onClick: () => run(first, error) } } : {}),
    });
  };
}

/** Dialog placement: title = outcome (first sentence), body = the rest, buttons = catalog actions. */
export function ErrorDialog({
  error,
  open,
  onOpenChange,
  onAction,
  children,
}: {
  error: AppError;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAction?: OnAction;
  children?: ReactNode;
}) {
  const p = present(error);
  const run = useRunAction(onAction);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={p.title}
      severity={p.severity}
      // Catalog lists actions most-important first; boards put the primary on the right.
      footer={[...p.actions].reverse().map((l) => (
        <Button
          key={l}
          variant={l === p.actions[0] && l !== 'Copy details' ? 'primary' : 'ghost'}
          onClick={() => {
            run(l, error);
            // With onAction the caller owns the outcome ("Keep waiting", "Try again" on a result step).
            // Without it, a choice ends the dialog — except copy actions, which keep it open.
            if (!onAction && !l.startsWith('Copy')) onOpenChange(false);
          }}
        >
          {l}
        </Button>
      ))}
    >
      {p.body && <p className="m-0">{p.body}</p>}
      {children}
    </Dialog>
  );
}

/** Full-page state placement. 1–3 actions. */
export function ErrorPage({
  error,
  icon,
  onAction,
}: {
  error: AppError;
  icon: LucideIcon;
  onAction?: OnAction;
}) {
  const p = present(error);
  return (
    <EmptyState
      icon={icon}
      severity={p.severity}
      title={p.title}
      actions={p.actions.length ? <Actions p={p} e={error} onAction={onAction} max={3} /> : undefined}
    >
      {p.body}
    </EmptyState>
  );
}

/** Panel list placement: AppErrors → ProblemsPanel rows. `locate` names where each one is. */
export function toProblems(errors: { id: string; error: AppError; location: ReactNode }[]): Problem[] {
  return errors.map(({ id, error, location }) => {
    const p = present(error);
    return {
      id,
      severity: p.severity === 'success' ? 'info' : p.severity,
      location,
      message: p.message,
      code: p.code,
    };
  });
}

/** One per route and per panel, so one broken widget does not blank the page (API-SHAPE). */
/**
 * A crash in its children shows the catalog message instead. `resetKey`: when it changes (another page), the
 * error is cleared and the children render again — without remounting them on every change.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  override componentDidCatch(_e: unknown, _info: ErrorInfo) {
    // Nothing to log here: no telemetry by default (ARCHITECTURE.md § Security). Copy details carries the cause.
  }
  override render() {
    if (!this.state.error) return this.props.children;
    const e =
      this.state.error instanceof AppError
        ? this.state.error
        : new AppError('API-SHAPE', {}, this.state.error);
    return <ErrorBanner error={e} />;
  }
}
