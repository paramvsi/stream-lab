import type { Connection, KindChoice } from '@sl/flink';
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
  { name: 'home' } | { name: 'kind'; kind: KindChoice | null } | { name: 'form'; kind: Connection['kind'] };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  if (screen.name === 'form')
    return (
      <ConnectionForm
        kind={screen.kind}
        taken={connections.map((c) => c.name)}
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
        const n = added.length + replace.length;
        toast({ severity: 'success', message: `Imported ${n} connection${n === 1 ? '' : 's'}.` });
      }}
    />
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
        onImport={() => setImporting(true)}
        onRemove={(id) => setConnections((cs) => cs.filter((c) => c.id !== id))}
      />
      {importDialog}
    </>
  );
}
