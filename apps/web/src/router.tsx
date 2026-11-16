import { SharedRoute } from './sim/SharedRoute';
import { ErrorBoundary } from '@sl/errors';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ChapterPage } from './pages/Chapter';
import { Course } from './pages/Course';
import { ConceptDrawer, Glossary } from './pages/Glossary';
import { Gallery } from './pages/Gallery';
import { MyPipelines } from './pages/MyPipelines';
import { NotFound } from './pages/NotFound';
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

// ponytail: "/" is the M5 landing; until then it opens the gallery.
const index = createRoute({
  getParentRoute: () => root,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/new' });
  },
});
const gallery = createRoute({ getParentRoute: () => root, path: '/new', component: Gallery });
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

// EXP-04 share links: #/s/<data> (D51).
const shared = createRoute({
  getParentRoute: () => root,
  path: '/s/$data',
  component: function Shared() {
    const { data } = shared.useParams();
    return <SharedRoute key={data} data={data} />;
  },
});

/** Hash history: the site is static files with no server rewrites (ARCHITECTURE.md). */
export const router = createRouter({
  routeTree: root.addChildren([index, gallery, pipelines, sim, shared, learn, chapter, glossary]),
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
