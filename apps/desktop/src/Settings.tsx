import { Button, Field, Select, Tabs } from '@sl/ui';
import { ArrowLeft } from 'lucide-react';
import { useId } from 'react';
import { useScreenHeading } from './focus';

/** The refresh intervals a connection can have (the connection form's list). */
export const POLL_CHOICES = [2000, 5000, 15000, 30000];

/**
 * APP-04 / boards D21: Settings. General: the theme (light only: v1 adds dark) and the default refresh interval
 * that a new connection starts with. About: the trademark line.
 * ponytail: what needs the Tauri shell is not drawn yet (menu bar, open the last connection on launch, crash
 * reports, History & storage, Updates), nor About's version, licence and links (none exist yet): MORNING.
 */
export function Settings({
  pollMs,
  onPollMs,
  onBack,
}: {
  pollMs: number;
  onPollMs: (ms: number) => void;
  onBack: () => void;
}) {
  const h1 = useScreenHeading();
  const theme = useId();
  const darkWhy = useId();
  return (
    <main className="flex min-h-screen flex-col gap-5 bg-surface px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 ref={h1} tabIndex={-1} className="m-0 text-[26px] font-semibold outline-none">
          Settings
        </h1>
        <Button icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack}>
          Back
        </Button>
      </div>
      <Tabs
        label="Settings"
        items={[
          {
            value: 'general',
            label: 'General',
            content: (
              <div className="flex max-w-xl flex-col gap-6 pt-5">
                <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                  <legend className="mb-2 text-[14px] font-semibold">Theme</legend>
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="radio" name={theme} checked readOnly className="sl-focus accent-rose-600" />
                    Light
                  </label>
                  <label className="flex items-center gap-2 text-[14px] text-muted">
                    <input
                      type="radio"
                      name={theme}
                      disabled
                      aria-describedby={darkWhy}
                      className="sl-focus accent-rose-600"
                    />
                    Dark
                  </label>
                  <span id={darkWhy} className="text-[13px] text-muted">
                    Dark theme coming in v1
                  </span>
                </fieldset>
                <Field label="Default refresh interval">
                  <Select value={pollMs} onChange={(e) => onPollMs(Number(e.target.value))}>
                    {POLL_CHOICES.map((ms) => (
                      <option key={ms} value={ms}>
                        {ms / 1000} seconds
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ),
          },
          {
            value: 'about',
            label: 'About',
            content: (
              <p className="m-0 max-w-xl pt-5 text-[14px] text-muted">
                Apache Flink and Flink are trademarks of the Apache Software Foundation. Stream Lab is not
                affiliated with the ASF.
              </p>
            ),
          },
        ]}
      />
    </main>
  );
}
