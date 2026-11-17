import type { Connection, FlinkHttp, KindChoice } from '@sl/flink';
import { Fleet, type CardState } from './Fleet';
import { useToast } from '@sl/ui';
import { useEffect, useState } from 'react';
import { ConnectionForm } from './ConnectionForm';
import { Connections } from './Connections';
import { ImportDialog } from './ImportDialog';
import { Cluster } from './Cluster';
import { memoryHistory } from './history';
import { JobOverview } from './JobOverview';
import { Logs } from './Logs';
import { Palette, type Command } from './Palette';
import { Jobs } from './Jobs';
import { KindPicker } from './KindPicker';
import { Welcome } from './Welcome';

/**
 * The desktop app (M6). The same React code Tauri wraps (its devUrl); it reaches clusters only through the Rust
 * command flink_request (FLINK_API.md), which is not built yet. First run: Welcome (D01), "where does your cluster
 * run?" (C01, step 1 of 3), the connection form (D02, step 2); then the connection list (D03).
 * ponytail: screen state, not a router, until there is more than one flow; saved connections are held in memory
 * (and their secrets nowhere) until the Tauri storage (SQLite) and keychain land.
 */
type Screen =
  | { name: 'home' }
  | { name: 'list' }
  | { name: 'cluster'; id: string }
  | { name: 'jobs'; id: string }
  | { name: 'job'; id: string; jid: string }
  | { name: 'logs'; id: string }
  | { name: 'kind'; kind: KindChoice | null }
  | { name: 'form'; kind: Connection['kind'] };

export function App({
  transport,
  test,
}: {
  transport?: (c: Connection) => FlinkHttp;
  /** Test connection before saving: the transport with the secret typed in the form (not yet in the keychain). */
  test?: (c: Connection, secret: string, more: { gateway: string; proxy: string }) => FlinkHttp;
} = {}) {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [importing, setImporting] = useState(false);
  const [fleetCache] = useState(() => new Map<string, CardState>());
  // JOB-06: one history store for the app's life (SQLite with the Rust side).
  const [history] = useState(memoryHistory);
  const toast = useToast();
  const add = () => setScreen({ name: 'kind', kind: null });
  const home = () => setScreen({ name: 'home' });

  // APP-01 / board G01: ⌘K (Ctrl+K) anywhere but the connection steps, where a jump would drop what is typed.
  const [palette, setPalette] = useState(false);
  const inSteps = screen.name === 'form' || screen.name === 'kind';
  useEffect(() => {
    if (inSteps) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inSteps]);
  // ponytail: navigation only for now; jobs and job actions (board G01) are the next slices.
  const commands: Command[] = [
    ...(transport && connections.length ? [{ id: 'fleet', label: 'Fleet', run: home }] : []),
    { id: 'list', label: 'Connections', run: () => setScreen({ name: 'list' }) },
    { id: 'add', label: 'Add connection', run: add },
    ...(transport
      ? connections.flatMap((c): Command[] => [
          {
            id: `c-${c.id}`,
            label: c.name,
            hint: `Cluster · ${c.env}`,
            run: () => setScreen({ name: 'cluster', id: c.id }),
          },
          { id: `j-${c.id}`, label: `Jobs · ${c.name}`, run: () => setScreen({ name: 'jobs', id: c.id }) },
          { id: `l-${c.id}`, label: `Logs · ${c.name}`, run: () => setScreen({ name: 'logs', id: c.id }) },
        ])
      : []),
  ];
  const view = (() => {
    if (screen.name === 'form')
      return (
        <ConnectionForm
          kind={screen.kind}
          taken={connections.map((c) => c.name)}
          {...(test ? { test } : {})}
          onCancel={() => setScreen({ name: 'kind', kind: screen.kind })}
          onSave={({ connection }) => {
            setConnections((cs) => [...cs, connection]);
            toast({ severity: 'success', message: `Saved ${connection.name}.` });
            setScreen({ name: 'home' });
          }}
        />
      );
    if (screen.name === 'kind')
      return (
        <KindPicker
          value={screen.kind}
          onChange={(kind) => setScreen({ name: 'kind', kind })}
          onBack={() => setScreen({ name: 'home' })}
          onContinue={() =>
            screen.kind && screen.kind !== 'confluent' && setScreen({ name: 'form', kind: screen.kind })
          }
        />
      );
    // Home: Welcome (D01) with no connections yet, else the connection list (D03).
    const open =
      screen.name === 'jobs' || screen.name === 'cluster' || screen.name === 'job' || screen.name === 'logs'
        ? connections.find((c) => c.id === screen.id)
        : undefined;
    if (transport && open && screen.name === 'cluster')
      return (
        <Cluster
          key={open.id}
          c={open}
          transport={transport}
          onFleet={home}
          onJobs={() => setScreen({ name: 'jobs', id: open.id })}
          onLogs={() => setScreen({ name: 'logs', id: open.id })}
        />
      );
    if (transport && open && screen.name === 'logs')
      return (
        <Logs
          key={open.id}
          c={open}
          transport={transport}
          onCluster={() => setScreen({ name: 'cluster', id: open.id })}
        />
      );
    if (transport && open && screen.name === 'job')
      return (
        <JobOverview
          key={`${open.id}/${screen.jid}`}
          c={open}
          jid={screen.jid}
          transport={transport}
          history={history}
          onJobs={() => setScreen({ name: 'jobs', id: open.id })}
        />
      );
    if (transport && open)
      return (
        <Jobs
          key={open.id}
          c={open}
          transport={transport}
          onFleet={home}
          onCluster={() => setScreen({ name: 'cluster', id: open.id })}
          onOpenJob={(jid) => setScreen({ name: 'job', id: open.id, jid })}
        />
      );
    const importDialog = (
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        existing={connections}
        onImport={({ add: added, replace }) => {
          setConnections((cs) => [...cs.map((c) => replace.find((r) => r.id === c.id) ?? c), ...added]);
          // A replaced connection keeps its id, not its cluster: the fleet forgets what the old one said.
          for (const r of replace) fleetCache.delete(r.id);
          const n = added.length + replace.length;
          toast({ severity: 'success', message: `Imported ${n} connection${n === 1 ? '' : 's'}.` });
        }}
      />
    );
    // With a way to reach clusters, home is the fleet (D04); the list is one click away.
    if (transport && connections.length && screen.name === 'home')
      return (
        <>
          <Fleet
            connections={connections}
            transport={transport}
            onAdd={add}
            onManage={() => setScreen({ name: 'list' })}
            cache={fleetCache}
            onOpen={(c) => setScreen({ name: 'cluster', id: c.id })}
          />
          {importDialog}
        </>
      );
    if (!connections.length)
      return (
        <>
          <Welcome onAdd={add} onImport={() => setImporting(true)} />
          {importDialog}
        </>
      );
    return (
      <>
        <Connections
          connections={connections}
          onAdd={add}
          {...(transport ? { onFleet: () => setScreen({ name: 'home' }) } : {})}
          onImport={() => setImporting(true)}
          onRemove={(id) => {
            fleetCache.delete(id);
            setConnections((cs) => cs.filter((c) => c.id !== id));
          }}
        />
        {importDialog}
      </>
    );
  })();
  return (
    <>
      {view}
      {palette && !inSteps && <Palette commands={commands} onClose={() => setPalette(false)} />}
    </>
  );
}
