import { AppError, ErrorBanner, present } from '@sl/errors';
import { getSavepointDir, savepointStatus, stopWithSavepoint, type FlinkHttp } from '@sl/flink';
import { Button, Dialog, Field, Input, Loading, Skeleton, useToastOptional } from '@sl/ui';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

type Step =
  | { name: 'confirm' }
  | { name: 'running' }
  | { name: 'failed'; error: AppError }
  /** The status could not be read 3 times in a row: no more reads; the stop may still finish on the cluster. */
  | { name: 'lost'; error: AppError };

/** Reads in a row that may fail before giving up (a 404 trigger id, a cluster gone): never ask forever. */
const MAX_READ_FAILS = 3;
const LOST =
  'Stream Lab stopped asking for its progress. The stop may still finish on the cluster: check the job.';

/** How often a running stop is asked about: one GET each (the stop itself is never sent again); slower when a read fails. */
const EVERY_MS = 1_000;
const AFTER_FAIL_MS = 5_000;
/** SP-TIMEOUT (catalog): a savepoint still IN_PROGRESS after 10 min says so. */
export const SP_TIMEOUT_MS = 10 * 60_000;

const asAppError = (e: unknown, conn: string) =>
  e instanceof AppError ? e : new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);

/**
 * ACT-01 / boards D15 (confirm), D15b (in progress), D15c (done: a toast on the job page, as drawn), D15d
 * (failed, with Try again). The folder is the cluster's default (getSavepointDir) or one typed in; none is
 * SP-DIR-MISSING before anything is sent; a default that can not be read says why. The stop is one POST, never
 * retried; while it is sent the dialog can not be closed; a refusal says why and stays on confirm. Closed while it
 * runs, the stop goes on and its result comes as a toast. Each opening starts at the question (a stop that is
 * still running shows its progress).
 * ponytail: D15b's bytes / % and per-operator progress (a ruling on their meaning: MORNING); after a timed-out
 * POST the job's state should be read before anything else is offered.
 */
export function StopDialog({
  open,
  onOpenChange,
  http,
  conn,
  jid,
  job,
  fallbackFocus,
  onRunningChange,
  onCancelInstead,
  resume,
  onSent,
  lostBefore,
  onLost,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  http: FlinkHttp;
  conn: string;
  jid: string;
  job: string;
  /** Where focus goes on close when the trigger is gone (the job left RUNNING): the page heading. */
  fallbackFocus?: RefObject<HTMLElement | null>;
  /** A stop was sent and is still running (the page keeps other actions off meanwhile). */
  onRunningChange?: (running: boolean) => void;
  /** D15's "Cancel without a savepoint instead": the page closes this and opens the cancel dialog (D15e). */
  onCancelInstead?: () => void;
  /** A stop sent earlier from this job's page (the page was left and came back): followed on, never sent again. */
  resume?: { rid: string; at: number } | null;
  /** The app keeps the stop while it runs: told when one is accepted, and (null) when it ended done or failed. */
  onSent?: (s: { rid: string; at: number } | null) => void;
  /** A stop from this page whose status was lost earlier (the app keeps it): "may still be running" survives. */
  lostBefore?: boolean;
  /** Told when a stop's status is lost (true), and when a later stop completed (false: only that settles it). */
  onLost?: (lost: boolean) => void;
}) {
  const [step, setStep] = useState<Step>(resume ? { name: 'running' } : { name: 'confirm' });
  const [dir, setDir] = useState<string | null>(null);
  const [dirError, setDirError] = useState<AppError | null>(null);
  const [fromCluster, setFromCluster] = useState(false);
  const [drain, setDrain] = useState(false);
  const [fieldError, setFieldError] = useState<AppError | null>(null);
  const [sendError, setSendError] = useState<AppError | null>(null);
  const [sending, setSending] = useState(false);
  const [rid, setRid] = useState<string | null>(resume?.rid ?? null);
  const drainId = useId();
  const toast = useToastOptional();
  const openRef = useRef(open);
  // A stop whose status was lost may still be running on the cluster. Said on the next question (not a lock: a
  // lock could never clear while the job stays RUNNING, and would take away cancel when a stop is stuck); a new
  // stop that completes clears it.
  const [uncertain, setUncertain] = useState(!!lostBefore);
  const running = step.name === 'running';
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);
  // Closed by us (the stop ended): Radix gives no close-focus event then, and the trigger may be gone (the job
  // left RUNNING). After the close is committed, focus that fell to <body> goes to the page heading.
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
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const copy = (text: string) => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    const failed = () => {
      const p = present(new AppError('COPY-FAILED'));
      toast?.({ severity: p.severity, message: p.message });
    };
    if (!clip) return failed();
    clip.writeText(text).then(() => toast?.({ severity: 'success', message: 'Path copied' }), failed);
  };

  // Each opening (not one that finds a stop still running) starts at the question, with the folder read again.
  // Adjusted during render (React's pattern for state that follows a prop); `opening` keys the folder read.
  const [wasOpen, setWasOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && step.name !== 'running') {
      setStep({ name: 'confirm' });
      setFieldError(null);
      setSendError(null);
      setDir(null);
      setDirError(null);
      setOpening((n) => n + 1);
    }
  }
  useEffect(() => {
    if (!opening) return;
    let live = true;
    getSavepointDir(http, conn).then(
      (d) => {
        if (!live) return;
        setDir(d ?? '');
        setFromCluster(!!d);
      },
      (e: unknown) => {
        if (!live) return;
        setDir('');
        setFromCluster(false);
        setDirError(asAppError(e, conn));
      },
    );
    return () => {
      live = false;
    };
  }, [opening, http, conn]);

  // SP-TIMEOUT: still running 10 min after it was sent, the dialog says so once (Keep waiting hides it; Close
  // closes the dialog: the stop goes on and its result comes as a toast, as any running stop closed).
  const [started, setStarted] = useState<number | null>(resume?.at ?? null);
  const [slow, setSlow] = useState<'shown' | 'dismissed' | null>(null);
  // The time it has run, kept current while the warning shows (closed and reopened, it is still the real one), in
  // whole minutes: the warning is a polite live region, read again whenever its text changes.
  const [now, setNow] = useState(0);
  const note = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (step.name !== 'running' || started === null || slow) return;
    const t = setTimeout(
      () => {
        setNow(Date.now());
        setSlow('shown');
      },
      Math.max(0, started + SP_TIMEOUT_MS - Date.now()),
    );
    return () => clearTimeout(t);
  }, [step.name, started, slow]);
  useEffect(() => {
    if (step.name !== 'running' || slow !== 'shown') return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [step.name, slow]);

  // A running stop: one status read at a time until it is done, open or not (closed: the result is a toast).
  useEffect(() => {
    if (step.name !== 'running' || !rid) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    const ask = () =>
      savepointStatus(http, conn, jid, rid).then(
        (s) => {
          if (!live) return;
          fails = 0;
          if (!s.done) timer = setTimeout(ask, EVERY_MS);
          else if ('location' in s) {
            // Only a stop that completed settles a lost one (Flink 1.20 accepts a second stop with 202 and fails
            // it later: an accepted or failed one does not).
            setUncertain(false);
            onLost?.(false);
            onSent?.(null);
            // D15c: the job page with a toast, as drawn; the dialog closes.
            setStep({ name: 'confirm' });
            closedByUs.current = true;
            onOpenChange(false);
            const location = s.location;
            // D15c "refund-matcher stopped. Savepoint sp-a71e saved.": the savepoint's own folder name.
            const name = location.split('/').filter(Boolean).at(-1) ?? location;
            toast?.({
              severity: 'success',
              message: `${job} stopped. Savepoint ${name} saved.`,
              action: { label: 'Copy path', onClick: () => copy(location) },
            });
          } else {
            onSent?.(null);
            if (openRef.current) return setStep({ name: 'failed', error: s.error });
            setStep({ name: 'confirm' });
            const p = present(s.error);
            toast?.({ severity: p.severity, message: p.message });
          }
        },
        // A read that fails is asked again, slower (a GET; the stop itself is not re-sent), up to MAX_READ_FAILS.
        (e: unknown) => {
          if (!live) return;
          if (++fails < MAX_READ_FAILS) return void (timer = setTimeout(ask, AFTER_FAIL_MS));
          const error = asAppError(e, conn);
          setUncertain(true);
          onLost?.(true);
          // Handed back too: a rid Flink no longer knows would fail again at every visit, with a false warning.
          // "May still be running" is said on the next question (uncertain).
          onSent?.(null);
          if (openRef.current) return setStep({ name: 'lost', error });
          setStep({ name: 'confirm' });
          toast?.({ severity: 'warning', message: `${present(error).message} ${LOST}` });
        },
      );
    timer = setTimeout(ask, EVERY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.name, rid, http, conn, jid]);

  const stop = () => {
    const folder = dir?.trim() ?? '';
    if (!folder) return setFieldError(new AppError('SP-DIR-MISSING'));
    setFieldError(null);
    setSendError(null);
    setSending(true);
    stopWithSavepoint(http, conn, jid, job, { dir: folder, drain }).then(
      (r) => {
        setSending(false);
        setRid(r);
        setStep({ name: 'running' });
        const at = Date.now();
        setStarted(at);
        onSent?.({ rid: r, at });
        setSlow(null);
      },
      (e: unknown) => {
        setSending(false);
        setSendError(asAppError(e, conn));
      },
    );
  };

  // Not while the stop is being sent: closing then would leave a stop the user did not see answered.
  const change = (o: boolean) => {
    if (!o && sending) return;
    onOpenChange(o);
  };
  const close = () => change(false);
  const onCloseAutoFocus = () =>
    setTimeout(() => {
      if (document.activeElement === document.body || !document.activeElement)
        fallbackFocus?.current?.focus();
    }, 0);
  const shared = { open, onOpenChange: change, onCloseAutoFocus };

  if (step.name === 'running')
    return (
      <Dialog
        {...shared}
        title={`Stopping ${job}`}
        // D15b: the stop goes on (its result comes as a toast on the job page).
        footer={<Button onClick={close}>Run in background</Button>}
      >
        {slow === 'shown' && started !== null && (
          <ErrorBanner
            error={new AppError('SP-TIMEOUT', { dur: `${Math.floor((now - started) / 60_000)} min` })}
            handles={new Set(['Keep waiting', 'Close'])}
            onAction={(a) => {
              if (a !== 'Keep waiting') return close();
              note.current?.focus(); // the banner and its button go: focus stays in the dialog, visibly
              setSlow('dismissed');
            }}
          />
        )}
        <Loading label="Writing savepoint">
          <p className="m-0 text-[14px]">Writing savepoint…</p>
          <Skeleton className="mt-3 h-2 w-full" />
        </Loading>
        <p ref={note} tabIndex={-1} className="sl-focus m-0 rounded-sm text-[13px] text-muted">
          You can close this; the stop goes on. Stay on this page to be told when it ends.
        </p>
      </Dialog>
    );
  if (step.name === 'lost')
    return (
      <Dialog {...shared} title={`Stopping ${job}`} footer={<Button onClick={close}>Close</Button>}>
        <ErrorBanner error={step.error} />
        <p className="m-0 text-[14px]">{LOST}</p>
      </Dialog>
    );
  if (step.name === 'failed')
    return (
      <Dialog
        {...shared}
        title="Savepoint failed"
        severity="error"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setStep({ name: 'confirm' });
                // A resumed stop never read the folder: read it now, as an opening does. A folder already there
                // (perhaps typed) stays: a form keeps its content on error.
                if (dir === null) {
                  setDirError(null);
                  setOpening((n) => n + 1);
                }
              }}
            >
              Try again
            </Button>
          </>
        }
      >
        <p className="m-0 text-[14px]">{present(step.error).message}</p>
      </Dialog>
    );
  return (
    <Dialog
      {...shared}
      title={`Stop ${job} with a savepoint?`}
      footer={
        <>
          {onCancelInstead && (
            <Button variant="ghost" disabled={sending} className="mr-auto" onClick={onCancelInstead}>
              Cancel without a savepoint instead
            </Button>
          )}
          <Button variant="secondary" disabled={sending} onClick={close}>
            Keep running
          </Button>
          <Button variant="primary" loading={sending} disabled={dir === null} onClick={stop}>
            Stop with savepoint
          </Button>
        </>
      }
    >
      <p className="m-0 text-[14px]">
        Flink writes a savepoint, then stops the job. You can restart from it later without losing state.
      </p>
      {uncertain && (
        <p className="m-0 text-[13px] text-muted">A stop sent earlier may still be running on the cluster.</p>
      )}
      {sendError && <ErrorBanner error={sendError} />}
      {dir === null ? (
        <Loading label="Reading the savepoint folder">
          <Skeleton className="h-9 w-full" />
        </Loading>
      ) : (
        <>
          {dirError && <ErrorBanner error={dirError} />}
          <Field
            label="Savepoint folder"
            {...(fromCluster ? { help: "From this cluster's default savepoint folder" } : {})}
            {...(fieldError ? { error: present(fieldError).message } : {})}
          >
            <Input mono value={dir} onChange={(e) => setDir(e.target.value)} />
          </Field>
        </>
      )}
      <div className="flex items-start gap-2">
        <input
          id={drainId}
          type="checkbox"
          checked={drain}
          onChange={(e) => setDrain(e.target.checked)}
          className="sl-focus mt-1 size-4 accent-rose-600"
          aria-describedby={`${drainId}-help`}
        />
        <div className="flex flex-col">
          <label htmlFor={drainId} className="text-[14px] font-medium">
            Drain
          </label>
          <span id={`${drainId}-help`} className="text-[13px] text-muted">
            Fire all windows and timers first. Use only for a final stop.
          </span>
        </div>
      </div>
    </Dialog>
  );
}
