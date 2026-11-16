import { SharedRoute } from './sim/SharedRoute';
import { ErrorBoundary } from '@sl/errors';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { ChapterPage } from './pages/Chapter';
import { Course } from './pages/Course';
import { Landing } from './pages/Landing';
import { DownloadPage } from './pages/Download';
import { ConceptDrawer, Glossary } from './pages/Glossary';
import { Gallery } from './pages/Gallery';
import { MyPipelines } from './pages/MyPipelines';
import { NotFound } from './pages/NotFound';
import { needsSimulator } from './pages/Unsupported';
import { WorkspaceRoute } from './sim/WorkspaceRoute';

const root = createRootRoute({
  component: () => (
    <ErrorBoundary>
      <Outlet />
      {/* LEARN-04: a concept opens over any page (a chapter, the glossary), without leaving it. */}
      <ConceptDrawer />
    </ErrorBoundary>
  ),
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
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
