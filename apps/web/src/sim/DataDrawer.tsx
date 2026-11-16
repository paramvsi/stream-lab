import { AppError, present } from '@sl/errors';
import { effectiveGenerator, generatorIssues, type GeneratorSettings as Gen } from '@sl/graph';
import { Button, Drawer, Field, Input, Tabs, useToast } from '@sl/ui';
import { Copy, Database } from 'lucide-react';
import { useState } from 'react';
import { useGraph } from './store';
import { UploadTab } from './UploadTab';

// What a run uses — the same function as run.ts, so the drawer never shows other values than the run reads.
const current = (): Gen => effectiveGenerator(useGraph.getState().data.generator, useGraph.getState().seed);

/**
 * DATA-01 Data drawer, generator tab (board W12): events, rate, seed (copyable), distinct cards and disorder.
 * Errors are GEN-INVALID on the field; nothing applies until "Apply and regenerate".
 * ponytail: the Upload tab is DATA-02 and key skew / fraud patterns are DATA-05 (later M3 slices).
 */
function DataForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  // Text per field so an empty or half-typed box is kept as typed, not coerced.
  const [text, setText] = useState<Record<keyof Gen, string>>(
    () =>
      Object.fromEntries(Object.entries(current()).map(([k, v]) => [k, String(v)])) as Record<
        keyof Gen,
        string
      >,
  );
  const values = Object.fromEntries(
    Object.entries(text).map(([k, v]) => [k, v.trim() === '' ? NaN : Number(v)]),
  ) as Record<keyof Gen, number>;
  const issues = generatorIssues(values);
  const err = (f: keyof Gen) => {
    const i = issues.find((x) => x.field === f);
    return i ? present(new AppError('GEN-INVALID', { reason: i.reason })).message : undefined;
  };
  // The unit is part of the field's name for screen readers (the visible suffix is decoration).
  const field = (f: keyof Gen, label: string, suffix?: string, unit?: string, help?: string) => (
    <Field
      label={
        <>
          {label}
          {unit && <span className="sr-only"> ({unit})</span>}
        </>
      }
      error={err(f)}
      {...(help ? { help } : {})}
    >
      <span className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          value={text[f]}
          onChange={(e) => setText((t) => ({ ...t, [f]: e.target.value }))}
        />
        {suffix && (
          <span aria-hidden="true" className="shrink-0 text-[13px] text-muted">
            {suffix}
          </span>
        )}
      </span>
    </Field>
  );
  const copySeed = () => {
    const failed = () => {
      const p = present(new AppError('COPY-FAILED'));
      toast({ severity: p.severity, message: p.message });
    };
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip) return failed();
    clip.writeText(text.seed).then(() => toast({ severity: 'success', message: 'Seed copied' }), failed);
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (issues.length) return;
        // Unchanged settings change nothing (and do not restart a run).
        if (JSON.stringify(values) !== JSON.stringify(current())) useGraph.getState().setGenerator(values);
        onDone();
      }}
    >
      {field('count', 'Events')}
      {field('rate', 'Rate', '/ second', 'events per second')}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {field('seed', 'Seed', undefined, undefined, 'Same seed, same run.')}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-[26px]"
          icon={<Copy size={16} aria-hidden="true" />}
          onClick={copySeed}
          {...(err('seed') ? { disabledReason: 'Enter a valid seed first.' } : {})}
        >
          Copy seed
        </Button>
      </div>
      {field('keys', 'Distinct cards')}
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold">Disorder</legend>
        {field('outOfOrderPct', 'Out of order', '%', 'percent')}
        {field('latePct', 'Late (beyond the out-of-orderness)', '%', 'percent')}
        {field('duplicatePct', 'Duplicates', '%', 'percent')}
        {field('badRowsPct', 'Malformed', '%', 'percent')}
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          {...(issues.length
            ? { disabledReason: `Fix ${issues.length} setting${issues.length > 1 ? 's' : ''} first.` }
            : {})}
        >
          Apply and regenerate
        </Button>
      </div>
    </form>
  );
}

export function DataButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Database size={16} aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Data
      </Button>
      <Drawer open={open} onOpenChange={setOpen} title="Data">
        {/* Remounted per open: Cancel discards edits. */}
        {open && (
          <Tabs
            label="Data source"
            items={[
              { value: 'generator', label: 'Generator', content: <DataForm onDone={() => setOpen(false)} /> },
              { value: 'upload', label: 'Upload file', content: <UploadTab onDone={() => setOpen(false)} /> },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
