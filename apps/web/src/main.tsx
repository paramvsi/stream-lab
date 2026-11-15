import '@sl/ui/src/fonts.css';
import '@sl/ui/styles.css';
import { ErrorBoundary } from '@sl/errors';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// ponytail: placeholder shell. Routes (/, /learn, /sim/:id, /glossary, /download) arrive in M1–M5.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <ErrorBoundary>
          <main className="flex min-h-screen flex-col items-center justify-center gap-4">
            <img src="/logo-mark.svg" width={64} height={64} alt="" />
            <h1 className="m-0 text-[36px] font-semibold tracking-[-0.02em]">
              stream<span className="text-rose-600">lab</span>
            </h1>
            <p className="m-0 text-muted">Foundations are in place. The simulator arrives in M1.</p>
          </main>
        </ErrorBoundary>
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
