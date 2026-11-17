import { AppError, present } from '@sl/errors';
import { getSavepointDir, savepointStatus, triggerSavepoint, type FlinkHttp } from '@sl/flink';
import { useToastOptional } from '@sl/ui';
import { useEffect, useRef, useState } from 'react';

const EVERY_MS = 1_000;
const AFTER_FAIL_MS = 5_000;
const MAX_READ_FAILS = 3;

const asAppError = (e: unknown, conn: string) =>
  e instanceof AppError ? e : new AppError('CONN-IO', { host: conn, reason: 'the request failed' }, e);

/**
 * ACT-02 / board D15f: trigger a savepoint without stopping. No dialog (the job keeps running): one POST to the
 * cluster's default folder, never retried; "Savepoint in progress for <job>" while it runs (one GET a second,
 * at most 3 failed reads in a row), then the saved name or SP-FAILED, as toasts. One at a time per page.
 * ponytail: D15f's % (needs checkpoint stats); with no default folder it says SP-DIR-MISSING (asking for one is a
 * next slice); followed only while this job page is open.
 */
export function useTriggerSavepoint(http: FlinkHttp, conn: string, jid: string, job: string) {
  const toast = useToastOptional();
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const say = (e: unknown) => {
    const p = present(asAppError(e, conn));
    toast?.({ severity: p.severity, message: p.message });
  };

  const follow = (rid: string) => {
    let fails = 0;
    const ask = () =>
      savepointStatus(http, conn, jid, rid).then(
        (s) => {
          if (!live.current) return;
          fails = 0;
          if (!s.done) return void setTimeout(ask, EVERY_MS);
          setBusy(false);
          if ('location' in s) {
            const name = s.location.split('/').filter(Boolean).at(-1) ?? s.location;
            toast?.({ severity: 'success', message: `Savepoint ${name} saved for ${job}.` });
          } else say(s.error);
        },
        (e: unknown) => {
          if (!live.current) return;
          if (++fails < MAX_READ_FAILS) return void setTimeout(ask, AFTER_FAIL_MS);
          setBusy(false);
          say(e);
        },
      );
    setTimeout(ask, EVERY_MS);
  };

  const trigger = () => {
    if (busy) return;
    setBusy(true);
    getSavepointDir(http, conn)
      .then((dir) => {
        if (!dir) throw new AppError('SP-DIR-MISSING');
        return triggerSavepoint(http, conn, jid, job, dir);
      })
      .then(
        (rid) => {
          if (!live.current) return;
          toast?.({ severity: 'info', message: `Savepoint in progress for ${job}` });
          follow(rid);
        },
        (e: unknown) => {
          if (!live.current) return;
          setBusy(false);
          say(e);
        },
      );
  };

  return { busy, trigger };
}
