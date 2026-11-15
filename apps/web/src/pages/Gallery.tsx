import { AppError } from '@sl/errors';
import { Button, Loading, Skeleton } from '@sl/ui';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { fromScenario, SCENARIOS, type Scenario } from '../sim/scenarios';
import { newId, useGraph } from '../sim/store';
import { savePipeline } from '../storage';
import { SiteShell } from './SiteShell';

/** W07 New pipeline · scenario gallery; W07b loading a scenario (SIM-01). */
export function Gallery() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Scenario | null>(null);

  const start = async (s: Scenario) => {
    setBusy(s);
    const p = fromScenario(s, newId('p'));
    // In memory first: the workspace opens even if storage is blocked or full (autosave shows the banner).
    useGraph.getState().load(p);
    await savePipeline(p).catch((e: unknown) => {
      if (!(e instanceof AppError)) throw e;
    });
    await navigate({ to: '/sim/$id', params: { id: p.id } });
  };

  return (
    <SiteShell eyebrow="Simulator" title="Start a pipeline">
      <p className="m-0 text-[16px] text-muted">
        Pick a scenario with data and a starter pipeline, or start blank.
      </p>
      {busy ? (
        <Loading label={`Setting up "${busy.title}"`}>
          <p className="m-0 text-[15px] font-semibold">Setting up &ldquo;{busy.title}&rdquo;</p>
          <Skeleton height={120} />
          <Skeleton height={16} width="60%" />
        </Loading>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 p-0">
          {SCENARIOS.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-card"
            >
              <span className="w-fit rounded-pill bg-subtle px-2.5 py-0.5 text-[12px] font-medium text-muted">
                {s.tag}
              </span>
              <h2 className="m-0 text-[19px] font-semibold">{s.title}</h2>
              <p className="m-0 flex-1 text-[14px] leading-[22px] text-muted">{s.description}</p>
              <Button
                variant={s.id === 'blank' ? 'secondary' : 'primary'}
                icon={<ArrowRight size={16} aria-hidden="true" />}
                onClick={() => void start(s)}
              >
                {s.id === 'blank' ? 'Start blank' : 'Use this scenario'}
                {/* Name = visible text first (label-in-name), then which scenario. */}
                {s.id !== 'blank' && <span className="sr-only">: {s.title}</span>}
              </Button>
            </li>
          ))}
          <li
            aria-disabled="true"
            className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong p-5 opacity-70"
          >
            <span className="w-fit rounded-pill bg-subtle px-2.5 py-0.5 text-[12px] font-medium text-muted">
              E-commerce
            </span>
            <h2 className="m-0 text-[19px] font-semibold">Cart abandonment</h2>
            <p className="m-0 flex-1 text-[14px] leading-[22px] text-muted">
              Clickstream, carts and orders. Find carts left for 30 minutes.
            </p>
            <span className="text-[13px] font-medium text-muted">Coming in v1</span>
          </li>
        </ul>
      )}
    </SiteShell>
  );
}
