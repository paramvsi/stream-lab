import '@sl/ui/src/fonts.css';
import '@sl/ui/styles.css';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { inTauri, saveSecrets, tauriHttp } from './tauri';

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
                Object.fromEntries(Object.entries({ login: secret, ...more }).filter(([, v]) => v)),
              )
            }
            keep={saveSecrets}
          />
        ) : (
          <App />
        )}
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
