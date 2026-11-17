import { AppError, ErrorBanner, present } from '@sl/errors';
import { getSavepointDir, savepointStatus, stopWithSavepoint, type FlinkHttp } from '@sl/flink';
import { Button, Dialog, Field, Input, Loading, Skeleton, useToastOptional } from '@sl/ui';
import { Copy } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

type Step =
  | { name: 'confirm' }
  | { name: 'running' }
  | { name: 'done'; location: string }
  | { name: 'failed'; error: AppError };

/** How often a running stop is asked about (one GET each; the stop itself is never sent again). */
const EVERY_MS = 1_000;

/**
 * ACT-01 / boards D15 (confirm), D15b (in progress), D15c (done), D15d (failed). The folder is the cluster's
 * default (getSavepointDir) or one typed in; none is SP-DIR-MISSING before anything is sent. The stop is one
 * POST, never retried; a refusal says why here and the dialog stays on confirm.
 * ponytail: D15b's bytes / % and per-operator progress (needs checkpoint stats), "Run in background", the
 * "Cancel without a savepoint instead" link (D15e) and SP-TIMEOUT's threshold are next slices; after a timed-out
 * POST the job's state should be read before anything else is offered.
 */
export function StopDialog({
  open,
  onOpenChange,
  http,
  conn,
  jid,
  job,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  http: FlinkHttp;
  conn: string;
  jid: string;
  job: string;
}) {
  const [step, setStep] = useState<Step>({ name: 'confirm' });
  const [dir, setDir] = useState<string | null>(null);
  const [fromCluster, setFromCluster] = useState(false);
  const [drain, setDrain] = useState(false);
  const [fieldError, setFieldError] = useState<AppError | null>(null);
  const [sendError, setSendError] = useState<AppError | null>(null);
  const [sending, setSending] = useState(false);
  const [rid, setRid] = useState<string | null>(null);
  const drainId = useId();
  const toast = useToastOptional();

  // The cluster's default folder, read once per opening (a failed read leaves the field to fill in).
  useEffect(() => {
    if (!open) return;
    let live = true;
    getSavepointDir(http, conn).then(
      (d) => {
        if (!live) return;
        setDir(d ?? '');
        setFromCluster(!!d);
      },
      () => live && setDir(''),
    );
    return () => {
      live = false;
    };
  }, [open, http, conn]);

  // A running stop: one status read at a time until it is done.
  useEffect(() => {
    if (step.name !== 'running' || !rid) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () =>
      savepointStatus(http, conn, jid, rid).then(
        (s) => {
          if (!live) return;
          if (!s.done) timer = setTimeout(ask, EVERY_MS);
          else if ('location' in s) setStep({ name: 'done', location: s.location });
          else setStep({ name: 'failed', error: s.error });
        },
        // A read that fails is asked again: a GET, the stop itself is not re-sent.
        () => live && (timer = setTimeout(ask, EVERY_MS)),
      );
    timer = setTimeout(ask, EVERY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
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
      },
      (e: unknown) => {
        setSending(false);
        setSendError(
          e instanceof AppError
            ? e
            : new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e),
        );
      },
    );
  };

  const close = () => onOpenChange(false);
  const copy = (text: string) => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    const failed = () => {
      const p = present(new AppError('COPY-FAILED'));
      toast?.({ severity: p.severity, message: p.message });
    };
    if (!clip) return failed();
    clip.writeText(text).then(() => toast?.({ severity: 'success', message: 'Path copied' }), failed);
  };

  if (step.name === 'running')
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title={`Stopping ${job}`}>
        <Loading label="Writing savepoint">
          <p className="m-0 text-[14px]">Writing savepoint…</p>
          <Skeleton className="mt-3 h-2 w-full" />
        </Loading>
      </Dialog>
    );
  if (step.name === 'done')
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={`${job} stopped`}
        severity="success"
        footer={<Button onClick={close}>Close</Button>}
      >
        <p className="m-0 text-[14px]">Savepoint saved:</p>
        <p className="m-0 font-mono text-[13px] break-all">{step.location}</p>
        <div>
          <Button size="sm" icon={<Copy size={14} aria-hidden="true" />} onClick={() => copy(step.location)}>
            Copy path
          </Button>
        </div>
      </Dialog>
    );
  if (step.name === 'failed')
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Savepoint failed"
        severity="error"
        footer={<Button onClick={close}>Close</Button>}
      >
        <p className="m-0 text-[14px]">{present(step.error).message}</p>
      </Dialog>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Stop ${job} with a savepoint?`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep running
          </Button>
          <Button variant="primary" loading={sending} onClick={stop}>
            Stop with savepoint
          </Button>
        </>
      }
    >
      <p className="m-0 text-[14px]">
        Flink writes a savepoint, then stops the job. You can restart from it later without losing state.
      </p>
      {sendError && <ErrorBanner error={sendError} />}
      {dir === null ? (
        <Loading label="Reading the savepoint folder">
          <Skeleton className="h-9 w-full" />
        </Loading>
      ) : (
        <Field
          label="Savepoint folder"
          {...(fromCluster ? { help: "From this cluster's default savepoint folder" } : {})}
          {...(fieldError ? { error: present(fieldError).message } : {})}
        >
          <Input mono value={dir} onChange={(e) => setDir(e.target.value)} />
        </Field>
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
