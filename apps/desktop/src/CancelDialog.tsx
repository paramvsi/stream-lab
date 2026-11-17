import { AppError, ErrorBanner } from '@sl/errors';
import { cancelJob, type FlinkHttp } from '@sl/flink';
import { Button, Dialog, Field, Input, useToastOptional } from '@sl/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * ACT-02 / board D15e: cancel, without a savepoint. Reached from the stop dialog ("Cancel without a savepoint
 * instead"), never a header button. On a prod connection the job name must be typed exactly (CLAUDE.md: prod
 * needs type-to-confirm); elsewhere Cancel job is ready. One PATCH, never retried; a refusal (e.g. API-409, the
 * job already ended) says why here. While it is sent the dialog can not be closed. Done: a toast, and focus that
 * fell to <body> goes to the page heading.
 */
export function CancelDialog({
  open,
  onOpenChange,
  http,
  conn,
  jid,
  job,
  prod,
  fallbackFocus,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  http: FlinkHttp;
  conn: string;
  jid: string;
  job: string;
  prod: boolean;
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<AppError | null>(null);
  const [sending, setSending] = useState(false);
  const toast = useToastOptional();

  // Each opening starts empty (adjusted during render: state that follows a prop).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTyped('');
      setError(null);
    }
  }

  // Closed by us when done: Radix may give no close-focus event, and the trigger may be gone.
  const closedByUs = useRef(false);
  useEffect(() => {
    if (open || !closedByUs.current) return;
    closedByUs.current = false;
    const t = setTimeout(() => {
      if (document.activeElement === document.body || !document.activeElement)
        fallbackFocus?.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open, fallbackFocus]);

  const ready = !prod || typed === job;
  const cancel = () => {
    if (!ready || sending) return;
    setError(null);
    setSending(true);
    cancelJob(http, conn, jid, job).then(
      () => {
        setSending(false);
        closedByUs.current = true;
        onOpenChange(false);
        toast?.({ severity: 'success', message: `${job} cancelled.` });
      },
      (e: unknown) => {
        setSending(false);
        setError(
          e instanceof AppError
            ? e
            : new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e),
        );
      },
    );
  };
  const change = (o: boolean) => {
    if (!o && sending) return;
    onOpenChange(o);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title={prod ? `Cancel ${job} on Production?` : `Cancel ${job}?`}
      severity="warning"
      footer={
        <>
          <Button variant="secondary" disabled={sending} onClick={() => change(false)}>
            Keep running
          </Button>
          <Button
            variant="danger"
            loading={sending}
            {...(!ready ? { disabledReason: 'Type the job name first.' } : {})}
            onClick={cancel}
          >
            Cancel job
          </Button>
        </>
      }
    >
      <p className="m-0 text-[14px]">
        Cancel stops the job <b>without a savepoint</b>. State since the last checkpoint is lost.
      </p>
      {error && <ErrorBanner error={error} />}
      {prod && (
        <Field label="Type the job name to confirm">
          <Input
            mono
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
    </Dialog>
  );
}
