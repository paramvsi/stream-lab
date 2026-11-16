import type { Connection, FlinkHttp, KindChoice } from '@sl/flink';
import { Fleet, type CardState } from './Fleet';
import { useToast } from '@sl/ui';
import { useState } from 'react';
import { ConnectionForm } from './ConnectionForm';
import { Connections } from './Connections';
import { ImportDialog } from './ImportDialog';
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
  const toast = useToast();
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
  const add = () => setScreen({ name: 'kind', kind: null });
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
}
