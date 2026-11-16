import { Button } from '@sl/ui';
import { BookOpen, Lock, Plus, SquareTerminal, Upload, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useScreenHeading } from './focus';

const CARDS: [LucideIcon, string, string][] = [
  [SquareTerminal, 'Try it locally', 'docker compose up gives you Flink on localhost:8081.'],
  [BookOpen, 'New to Flink?', 'The online course explains every number you see here.'],
  [Lock, 'Private by design', 'No account, no telemetry, secrets in your keychain.'],
];

/** INST-02 / board D01: the first run, no connections yet. */
export function Welcome({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  const h1 = useScreenHeading();
  useEffect(() => {
    document.title = 'Welcome · Stream Lab';
  }, []);
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-surface px-6">
      <div aria-hidden="true" className="sl-grid pointer-events-none absolute inset-0" />
      <div className="relative flex w-full max-w-[640px] flex-col gap-6">
        <img src="/logo-mark.svg" width={36} height={36} alt="" />
        <h1
          ref={h1}
          tabIndex={-1}
          className="m-0 text-[36px] leading-[1.15] font-bold tracking-[-0.02em] outline-none"
        >
          Welcome to Stream Lab
        </h1>
        <p className="m-0 text-[17px] text-muted">
          Connect a Flink cluster to see its jobs, checkpoints and history. Everything stays on this computer.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={onAdd}>
            Add a connection
          </Button>
          <Button icon={<Upload size={16} aria-hidden="true" />} onClick={onImport}>
            Import connections
          </Button>
        </div>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
          {CARDS.map(([Icon, t, d]) => (
            <li key={t} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-4">
              <Icon size={18} aria-hidden="true" className="text-rose-600" />
              <h2 className="m-0 text-[15px] font-semibold">{t}</h2>
              <p className="m-0 text-[13px] text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
