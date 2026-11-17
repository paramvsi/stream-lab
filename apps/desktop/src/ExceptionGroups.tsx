import { groupExceptions, rootCauseLine, type FlinkException } from '@sl/flink';
import { Button, EmptyState } from '@sl/ui';
import { CircleCheck } from 'lucide-react';
import { Fragment, useState } from 'react';

/** Board X20 "09:12": the viewer's local clock, hours and minutes. */
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * JOB-08 / board X20: a job's failures collapsed by root cause type and message (groupExceptions), most frequent
 * first, with count and first / last seen; "Show N" expands to each occurrence (newest first: time, task, cause).
 * ponytail: the "Explain this" hint (J-09) and the full trace with Copy (D11b) are next slices.
 */
export function ExceptionGroups({ entries }: { entries: readonly FlinkException[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const groups = groupExceptions(entries);
  if (!groups.length)
    return (
      <EmptyState icon={CircleCheck} title="No exceptions" level={3}>
        Flink has not recorded a failure for this job.
      </EmptyState>
    );
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const th = 'border-b border-line bg-subtle px-3.5 py-2.5 text-left text-[12px] font-medium text-muted';
  const td = 'border-b border-line px-3.5 py-[13px] align-top text-[14px]';
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] text-muted">
        {plural(groups.length, 'group')}, {plural(entries.length, 'occurrence')}
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
              const id = `exc-group-${i}`;
              const label = g.name || 'Exception';
              return (
                <Fragment key={id}>
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
                        aria-expanded={open.has(i)}
                        aria-controls={id}
                        onClick={() => toggle(i)}
                      >
                        {`Show ${g.count}`}
                      </Button>
                    </td>
                  </tr>
                  {open.has(i) && (
                    <tr id={id}>
                      <td colSpan={5} className="border-b border-line bg-subtle px-3.5 py-3">
                        <ul
                          aria-label={`${label} occurrences`}
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
