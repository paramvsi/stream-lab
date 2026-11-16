import { AppError, present } from '@sl/errors';
import {
  DEFAULT_GENERATOR,
  generatorIssues,
  GeneratorSettings,
  type GeneratorSettings as Gen,
} from '@sl/graph';
import { Button, Drawer, Field, Input, useToast } from '@sl/ui';
import { Copy, Database } from 'lucide-react';
import { useState } from 'react';
import { useGraph } from './store';

const current = (): Gen => {
  const { data, seed } = useGraph.getState();
  const g = GeneratorSettings.safeParse({ ...DEFAULT_GENERATOR, seed, ...(data.generator as object) });
  return g.success ? g.data : { ...DEFAULT_GENERATOR, seed };
};

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
  const field = (f: keyof Gen, label: string, suffix?: string) => (
    <Field label={label} error={err(f)}>
      <span className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          value={text[f]}
          onChange={(e) => setText((t) => ({ ...t, [f]: e.target.value }))}
        />
        {suffix && <span className="shrink-0 text-[13px] text-muted">{suffix}</span>}
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
        useGraph.getState().setGenerator(values);
        onDone();
      }}
    >
      {field('count', 'Events')}
      {field('rate', 'Rate', '/ second')}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">{field('seed', 'Seed')}</div>
          <Button
            type="button"
            variant="ghost"
            icon={<Copy size={16} aria-hidden="true" />}
            onClick={copySeed}
          >
            Copy seed
          </Button>
        </div>
        <p className="m-0 text-[13px] text-muted">Same seed, same run.</p>
      </div>
      {field('keys', 'Distinct cards')}
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold">Disorder</legend>
        {field('outOfOrderPct', 'Out of order', '%')}
        {field('latePct', 'Late (beyond the out-of-orderness)', '%')}
        {field('duplicatePct', 'Duplicates', '%')}
        {field('badRowsPct', 'Malformed', '%')}
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
        {open && <DataForm onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}
