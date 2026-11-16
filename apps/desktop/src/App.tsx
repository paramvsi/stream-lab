import type { KindChoice } from '@sl/flink';
import { useState } from 'react';
import { KindPicker } from './KindPicker';
import { Welcome } from './Welcome';

/**
 * The desktop app (M6). The same React code Tauri wraps (its devUrl); it reaches clusters only through the Rust
 * command flink_request (FLINK_API.md), which is not built yet. First run: Welcome (D01), then "where does your
 * cluster run?" (C01, step 1 of 3). ponytail: screen state, not a router, until there is more than one flow.
 */
type Screen = { name: 'welcome' } | { name: 'kind'; kind: KindChoice | null };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'welcome' });
  if (screen.name === 'kind')
    return (
      <KindPicker
        value={screen.kind}
        onChange={(kind) => setScreen({ name: 'kind', kind })}
        onBack={() => setScreen({ name: 'welcome' })}
      />
    );
  return <Welcome onAdd={() => setScreen({ name: 'kind', kind: null })} />;
}
