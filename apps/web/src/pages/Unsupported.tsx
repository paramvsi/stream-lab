import { AppError, ErrorPage } from '@sl/errors';
import { useNavigate } from '@tanstack/react-router';
import { MonitorX } from 'lucide-react';
import type { ComponentType } from 'react';
import { simulatorSupported } from '../support';
import { SiteShell } from './SiteShell';

/** WX07: the full-page BROWSER-UNSUPPORTED state, with "Read the course". */
export function Unsupported() {
  const navigate = useNavigate();
  return (
    <SiteShell docTitle="Browser not supported">
      <h1 className="sr-only">Browser not supported</h1>
      <div className="py-16">
        <ErrorPage
          icon={MonitorX}
          error={new AppError('BROWSER-UNSUPPORTED')}
          onAction={(label) => label === 'Read the course' && void navigate({ to: '/learn' })}
        />
      </div>
    </SiteShell>
  );
}

/** A simulator page, or WX07 when this browser can not run it. */
export const needsSimulator =
  <P extends object>(Page: ComponentType<P>) =>
  (props: P) =>
    simulatorSupported() ? <Page {...props} /> : <Unsupported />;
