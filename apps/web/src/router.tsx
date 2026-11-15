import { ErrorBoundary } from '@sl/errors';
import { Button, EmptyState } from '@sl/ui';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { Gallery } from './pages/Gallery';
import { MyPipelines } from './pages/MyPipelines';
import { WorkspaceRoute } from './sim/WorkspaceRoute';

/** W03 (LAND-05): the full 404 page with course links lands in M5; this is its copy, minus the course. */
function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={Compass}
        title="404 · event arrived after the watermark"
        actions={
          <Button variant="primary" onClick={() => void navigate({ to: '/new' })}>
            Open the simulator
          </Button>
        }
      >
        This page was dropped as late data. The link may be old, or the page moved.
      </EmptyState>
    </main>
  );
}

const root = createRootRoute({
  component: () => (
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
  ),
  notFoundComponent: NotFound,
});

// ponytail: "/" is the M5 landing; until then it opens the gallery.
const index = createRoute({
  getParentRoute: () => root,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/new' });
  },
});
const gallery = createRoute({ getParentRoute: () => root, path: '/new', component: Gallery });
const pipelines = createRoute({ getParentRoute: () => root, path: '/pipelines', component: MyPipelines });
const sim = createRoute({
  getParentRoute: () => root,
  path: '/sim/$id',
  component: function Sim() {
    const { id } = sim.useParams();
    // key: switching pipelines remounts the route (fresh load + autosave wiring).
    return <WorkspaceRoute key={id} id={id} />;
  },
});

/** Hash history: the site is static files with no server rewrites (ARCHITECTURE.md). */
export const router = createRouter({
  routeTree: root.addChildren([index, gallery, pipelines, sim]),
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
