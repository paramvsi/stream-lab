import '@sl/ui/src/fonts.css';
import '@sl/ui/styles.css';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { tauriSaved } from './saved';
import { inTauri, saveSecrets, tauriHttp } from './tauri';

// One store for the app's life (a new object each render would read the file again).
const saved = tauriSaved();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        {/* In the shell, clusters are reached through flink_request; in a plain browser there is no transport. */}
        {inTauri() ? (
          <App
            transport={(c) => tauriHttp(c)}
            test={(c, secret, more) =>
              tauriHttp(
                c,
                Object.fromEntries(
                  Object.entries({ login: secret, ...more }).filter(
                    // An empty proxy password is still the one to use (else Test looks in the keychain).
                    ([k, v]) => v || (k === 'proxy' && c.transport.type === 'proxy' && !!c.transport.user),
                  ),
                ),
              )
            }
            keep={saveSecrets}
            saved={saved}
          />
        ) : (
          <App />
        )}
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
