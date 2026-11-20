import { AppError, present } from '@sl/errors';
import { exceptionHint, groupExceptions, rootCauseLine, type FlinkException } from '@sl/flink';
import { Button, EmptyState, useToastOptional } from '@sl/ui';
import { CircleCheck, Copy, Lightbulb } from 'lucide-react';
import { Fragment, useId, useState } from 'react';

/** Board X20 "09:12": the viewer's local clock, hours and minutes. */
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * JOB-08 / board X20: a job's failures collapsed by root cause type and message (groupExceptions), most frequent
 * first, with count and first / last seen; "Show N" expands to each occurrence (newest first: time, task, cause).
 * Open, a group also shows its newest full stack trace with Copy (D11b).
 * X20's "Explain this" (ruled 2026-11-18: hints from the Flink docs): for the most frequent group with a hint.
 * ponytail: D11b's summary line is a next slice; X20's "Read the chapter" waits for the site's address.
 */
export function ExceptionGroups({
  entries,
  capped = false,
}: {
  entries: readonly FlinkException[];
  /** Flink may have dropped older failures (it keeps a few): the occurrences are a lower bound ("N+"). */
  capped?: boolean;
}) {
  // Open groups by their key, not their row: a poll re-sorts the rows.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const base = useId();
  const groups = groupExceptions(entries);
  if (!groups.length)
    return (
      <EmptyState icon={CircleCheck} title="No exceptions" level={2}>
        Flink has not recorded a failure for this job.
      </EmptyState>
    );
  const toggle = (i: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  // Accessible names: type · message, the message cut at 60 characters (by code point: never half a UTF-16 pair; a flag or joined emoji at the edge can still split),
  // since a long root-cause line would fill every name. Two groups cut alike get their row number.
  const cut = groups.map((g) => {
    const label = g.name || 'Exception';
    const cps = [...g.message];
    const msg = cps.length > 60 ? `${cps.slice(0, 59).join('')}…` : g.message;
    return msg ? `${label} · ${msg}` : label;
  });
  const titles = cut.map((t, i) => (cut.indexOf(t) !== cut.lastIndexOf(t) ? `${t} · row ${i + 1}` : t));
  // Groups are most frequent first: the first one Flink's docs have a hint for.
  // Named: it may not be the top row's (audit D7).
  const hinted = groups.map((g, i) => ({ i, text: exceptionHint(g.type, g.message) })).find((x) => x.text);
  const th = 'border-b border-line bg-subtle px-3.5 py-2.5 text-left text-[12px] font-medium text-muted';
  const td = 'border-b border-line px-3.5 py-[13px] align-top text-[14px]';
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] text-muted">
        {plural(groups.length, 'group')}, {entries.length}
        {capped ? '+' : ''} occurrence{entries.length === 1 && !capped ? '' : 's'}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table aria-label="Exceptions" className="w-full border-collapse text-ink">
          <thead>
            <tr>
              <th scope="col" className={th}>
                Exception
              </th>
              <th scope="col" className={`${th} text-right`}>
                Count
              </th>
              <th scope="col" className={th}>
                First seen
              </th>
              <th scope="col" className={th}>
                Last seen
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">Occurrences</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => {
              const id = `${base}-${i}`;
              const label = g.name || 'Exception';
              const title = titles[i]!;
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td className={td}>
                      <b>{label}</b>
                      {g.message && <span className="text-muted"> · {g.message}</span>}
                    </td>
                    <td className={`${td} text-right font-mono tabular-nums`}>{g.count}</td>
                    <td className={`${td} font-mono tabular-nums`}>{clock(g.first)}</td>
                    <td className={`${td} font-mono tabular-nums`}>{clock(g.last)}</td>
                    <td className={`${td} text-right`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={open.has(g.key)}
                        aria-controls={id}
                        onClick={() => toggle(g.key)}
                      >
                        {`Show ${g.count}`}
                      </Button>
                    </td>
                  </tr>
                  {open.has(g.key) && (
                    <tr id={id}>
                      <td colSpan={5} className="border-b border-line bg-subtle px-3.5 py-3">
                        <ul
                          aria-label={`Occurrences: ${title}`}
                          className="m-0 flex list-none flex-col gap-2 p-0"
                        >
                          {g.entries.map((e, k) => (
                            <li key={`${e.timestamp}-${k}`} className="flex flex-wrap gap-x-3 text-[13px]">
                              <span className="font-mono tabular-nums">{clock(e.timestamp)}</span>
                              {e.taskName && <span>{e.taskName}</span>}
                              <span className="font-mono text-muted">{rootCauseLine(e)}</span>
                            </li>
                          ))}
                        </ul>
                        <Trace e={g.entries[0]!} label={title} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hinted && (
        <p className="m-0 flex items-start gap-2 text-[14px]">
          <Lightbulb size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-rose-700" />
          <span>
            <strong className="font-semibold">Explain this ({titles[hinted.i]}):</strong> {hinted.text}
          </span>
        </p>
      )}
    </div>
  );
}

/** D11b: Java's printStackTrace, one line per item (its "... N more" kept), and Copy for the whole of it. */
function Trace({ e, label }: { e: FlinkException; label: string }) {
  const toast = useToastOptional();
  const copy = () => {
    const failed = () => {
      const p = present(new AppError('COPY-FAILED'));
      toast?.({ severity: p.severity, message: p.message });
    };
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip) return failed();
    clip
      .writeText(e.stacktrace)
      .then(() => toast?.({ severity: 'success', message: 'Stack trace copied' }), failed);
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div>
        {/* The name starts with the visible label (WCAG 2.5.3), then says which group. */}
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy size={14} aria-hidden="true" />}
          aria-label={`Copy stack trace (${label})`}
          onClick={copy}
        >
          Copy stack trace
        </Button>
      </div>
      {/* A scroller the keyboard can reach (as Table does). */}
      <div
        role="region"
        aria-label={`Stack trace: ${label}`}
        tabIndex={0}
        className="sl-focus max-h-64 overflow-auto rounded-md border border-line bg-surface p-3"
      >
        <ol
          aria-label={`Newest stack trace: ${label}`}
          className="m-0 list-decimal pl-8 font-mono text-[12px] text-ink"
        >
          {lines(e.stacktrace).map(({ text, depth }, i) => (
            // Java's nesting (Suppressed blocks and their causes) kept as depth.
            <li
              key={i}
              data-depth={depth}
              style={{ paddingLeft: `${depth * 2}ch` }}
              className="whitespace-pre-wrap break-all"
            >
              {text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Java's printStackTrace lines (CRLF or LF, its final line end dropped), each with its nesting depth. */
const lines = (trace: string) => {
  const ls = trace.split(/\r?\n/);
  if (ls.at(-1) === '') ls.pop();
  return ls.map((l) => {
    const tabs = /^\t*/.exec(l)![0].length;
    const text = l.slice(tabs);
    // Frames ("at …", "... N more") carry one tab of their own; "Caused by:" / "Suppressed:" lines do not.
    const frame = /^(at |\.\.\. \d+ more)/.test(text);
    return { text, depth: Math.max(0, frame ? tabs - 1 : tabs) };
  });
};
