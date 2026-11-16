import { AppError, ErrorBanner } from '@sl/errors';
import { KINDS, type KindChoice, type Support } from '@sl/flink';
import { Button, StatusBadge, type BadgeTone } from '@sl/ui';
import { useEffect, useId } from 'react';
import { useScreenHeading } from './focus';

const BADGE: Record<Support, [string, BadgeTone]> = {
  full: ['Full support', 'success'],
  limited: ['Limited', 'warning'],
  unsupported: ['Not supported', 'error'],
};

/**
 * CONN-01 / board C01: step 1 of 3, where the cluster runs. One choice (a radio group); Confluent Cloud is listed
 * but can not be picked further (CONN-KIND-UNSUPPORTED, inline in the picker). Continue goes to the form (step 2).
 */
export function KindPicker({
  value,
  onChange,
  onBack,
  onContinue,
}: {
  value: KindChoice | null;
  onChange: (k: KindChoice) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const name = useId();
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'New connection · Stream Lab';
  }, []);
  const picked = KINDS.find((k) => k.kind === value);
  const unsupported = picked?.support === 'unsupported';
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-8">
      <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
        New connection
      </h1>
      <p className="m-0 text-[14px] text-muted">Step 1 of 3 · where does it run?</p>
      <fieldset className="m-0 flex max-w-[760px] flex-col gap-2.5 border-0 p-0">
        <legend className="sr-only">Where does your cluster run?</legend>
        {KINDS.map((k) => {
          const [label, tone] = BADGE[k.support];
          const on = value === k.kind;
          return (
            <label
              key={k.kind}
              className={`flex cursor-pointer items-center gap-4 rounded-[12px] border px-3.5 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-rose-600 has-[:focus-visible]:ring-offset-2 ${on ? 'border-rose-600 bg-rose-50' : 'border-line hover:bg-subtle'}`}
            >
              <input
                type="radio"
                name={name}
                className="size-4 accent-rose-600 outline-none"
                checked={on}
                onChange={() => onChange(k.kind)}
              />
              <span className="flex flex-1 flex-col">
                <span className="text-[14px] font-semibold">{k.label}</span>
                <span className="text-[13px] text-muted">{k.hint}</span>
              </span>
              <StatusBadge tone={tone}>{label}</StatusBadge>
            </label>
          );
        })}
      </fieldset>
      {unsupported && picked && (
        // The catalog's placement and severity (inline in the picker, info).
        <div className="max-w-[760px]">
          <ErrorBanner error={new AppError('CONN-KIND-UNSUPPORTED', { kind: picked.label })} />
        </div>
      )}
      <div className="flex gap-3">
        <Button onClick={onBack}>Back</Button>
        <Button
          variant="primary"
          onClick={onContinue}
          {...(!picked
            ? { disabledReason: 'Choose where your cluster runs.' }
            : unsupported
              ? { disabledReason: 'This platform is not supported.' }
              : {})}
        >
          Continue
        </Button>
      </div>
    </main>
  );
}
