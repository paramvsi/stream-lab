import type { Connection, KindChoice } from '@sl/flink';
import { useToast } from '@sl/ui';
import { useState } from 'react';
import { ConnectionForm } from './ConnectionForm';
import { KindPicker } from './KindPicker';
import { Welcome } from './Welcome';

/**
 * The desktop app (M6). The same React code Tauri wraps (its devUrl); it reaches clusters only through the Rust
 * command flink_request (FLINK_API.md), which is not built yet. First run: Welcome (D01), "where does your cluster
 * run?" (C01, step 1 of 3), the connection form (D02, step 2).
 * ponytail: screen state, not a router, until there is more than one flow; saved connections are held in memory
 * (and their secrets nowhere) until the Tauri storage (SQLite) and keychain land.
 */
type Screen =
  | { name: 'welcome' }
  | { name: 'kind'; kind: KindChoice | null }
  | { name: 'form'; kind: Connection['kind'] };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'welcome' });
  const [connections, setConnections] = useState<Connection[]>([]);
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
          setScreen({ name: 'welcome' });
        }}
      />
    );
  if (screen.name === 'kind')
    return (
      <KindPicker
        value={screen.kind}
        onChange={(kind) => setScreen({ name: 'kind', kind })}
        onBack={() => setScreen({ name: 'welcome' })}
        onContinue={() =>
          screen.kind && screen.kind !== 'confluent' && setScreen({ name: 'form', kind: screen.kind })
        }
      />
    );
  return <Welcome onAdd={() => setScreen({ name: 'kind', kind: null })} />;
}
