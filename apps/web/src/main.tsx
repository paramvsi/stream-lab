import '@sl/ui/src/fonts.css';
import '@sl/ui/styles.css';
import { ErrorBoundary } from '@sl/errors';
import { ToastProvider, TooltipProvider } from '@sl/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from './sim/Workspace';

// ponytail: the workspace is the whole app until routes (/, /learn, /sim/:id …) land with the gallery slice.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <ErrorBoundary>
          <Workspace />
        </ErrorBoundary>
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
