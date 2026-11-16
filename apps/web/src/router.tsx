import { ErrorBoundary } from '@sl/errors';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { ChapterPage } from './pages/Chapter';
import { Course } from './pages/Course';
import { Landing } from './pages/Landing';
import { DownloadPage } from './pages/Download';
import { ConceptDrawer, Glossary } from './pages/Glossary';
import { NotFound } from './pages/NotFound';
import { needsSimulator } from './pages/Unsupported';
import { Suspense } from 'react';
import { lazyPage, PageLoading } from './pages/lazyPage';

// LAND-06: the simulator (canvas, engine, CEL, React Flow) loads with its pages, not with the landing or the course.
const Gallery = lazyPage(() => import('./pages/Gallery').then((m) => m.Gallery));
const MyPipelines = lazyPage(() => import('./pages/MyPipelines').then((m) => m.MyPipelines));
const WorkspaceRoute = lazyPage(() => import('./sim/WorkspaceRoute').then((m) => m.WorkspaceRoute));
const SharedRoute = lazyPage(() => import('./sim/SharedRoute').then((m) => m.SharedRoute));

const root = createRootRoute({
  component: function Root() {
    // Reset on another page: an error on one page does not stay on the next (it used to need a full reload).
    const path = useRouterState({ select: (r) => r.location.pathname });
    return (
      <ErrorBoundary resetKey={path}>
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
        {/* LEARN-04: a concept opens over any page (a chapter, the glossary), without leaving it. */}
        <ConceptDrawer />
      </ErrorBoundary>
    );
  },
  notFoundComponent: NotFound,
});

const index = createRoute({ getParentRoute: () => root, path: '/', component: Landing });
const gallery = createRoute({ getParentRoute: () => root, path: '/new', component: needsSimulator(Gallery) });
const download = createRoute({ getParentRoute: () => root, path: '/download', component: DownloadPage });
const glossary = createRoute({ getParentRoute: () => root, path: '/glossary', component: Glossary });
const learn = createRoute({ getParentRoute: () => root, path: '/learn', component: Course });
const chapter = createRoute({
  getParentRoute: () => root,
  path: '/learn/$chapter',
  component: function Chapter() {
    const { chapter: id } = chapter.useParams();
    return <ChapterPage key={id} id={id} />;
  },
});
const pipelines = createRoute({
  getParentRoute: () => root,
  path: '/pipelines',
  component: needsSimulator(MyPipelines),
});
const sim = createRoute({
  getParentRoute: () => root,
  path: '/sim/$id',
  component: needsSimulator(function Sim() {
    const { id } = sim.useParams();
    // key: switching pipelines remounts the route (fresh load + autosave wiring).
    return <WorkspaceRoute key={id} id={id} />;
  }),
});

// EXP-04 share links: #/s/<data> (D51).
const shared = createRoute({
  getParentRoute: () => root,
  path: '/s/$data',
  component: needsSimulator(function Shared() {
    const { data } = shared.useParams();
    return <SharedRoute key={data} data={data} />;
  }),
});

/** Hash history: the site is static files with no server rewrites (ARCHITECTURE.md). */
export const router = createRouter({
  routeTree: root.addChildren([index, gallery, pipelines, sim, shared, learn, chapter, glossary, download]),
  history: createHashHistory(),
  // A lazy page suspends inside the router's own boundary: this is what shows meanwhile (not a blank screen).
  defaultPendingComponent: PageLoading,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
