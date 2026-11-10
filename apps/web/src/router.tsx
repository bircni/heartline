import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { IncidentHistoryPage, IncidentPage } from './pages/IncidentPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { PublicLayout } from './pages/PublicLayout.tsx';
import { MAX_DAYS } from './pages/RangeControl.tsx';
import { ServicePage } from './pages/ServicePage.tsx';

type RangeSearch = { days?: number; to?: string };
const validateRange = (search: Record<string, unknown>): RangeSearch => {
  const days = Number(search.days);
  const to = typeof search.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.to) ? search.to : undefined;
  return {
    ...(Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? { days } : {}),
    ...(to ? { to } : {}),
  };
};

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="m-0 text-[18px] font-semibold">Page not found</h1>
      <Link to="/" className="text-sec">
        Go to the status page
      </Link>
    </div>
  );
}

const root = createRootRoute({ component: Outlet, notFoundComponent: NotFound });

const publicLayout = createRoute({
  getParentRoute: () => root,
  id: 'public',
  component: PublicLayout,
  validateSearch: validateRange,
});
const overview = createRoute({ getParentRoute: () => publicLayout, path: '/', component: OverviewPage });
const service = createRoute({
  getParentRoute: () => publicLayout,
  path: 'services/$id',
  component: ServicePage,
});
const incidentHistory = createRoute({
  getParentRoute: () => publicLayout,
  path: 'incidents',
  component: IncidentHistoryPage,
});
const incident = createRoute({
  getParentRoute: () => publicLayout,
  path: 'incidents/$id',
  component: IncidentPage,
});

const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  component: lazyRouteComponent(() => import('./pages/LoginPage.tsx'), 'LoginPage'),
});
const consent = createRoute({
  getParentRoute: () => root,
  path: '/consent',
  component: lazyRouteComponent(() => import('./pages/ConsentPage.tsx'), 'ConsentPage'),
});

const admin = createRoute({
  getParentRoute: () => root,
  path: '/admin',
  component: lazyRouteComponent(() => import('./pages/admin/AdminLayout.tsx'), 'AdminLayout'),
});
const adminIndex = createRoute({
  getParentRoute: () => admin,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/monitors' });
  },
});
const monitors = createRoute({
  getParentRoute: () => admin,
  path: 'monitors',
  component: lazyRouteComponent(() => import('./pages/admin/MonitorsPage.tsx'), 'MonitorsPage'),
});
const software = createRoute({
  getParentRoute: () => admin,
  path: 'software',
  validateSearch: (search: Record<string, unknown>): { service?: string } =>
    typeof search.service === 'string' && search.service ? { service: search.service } : {},
  component: lazyRouteComponent(() => import('./pages/admin/SoftwarePage.tsx'), 'SoftwarePage'),
});
const incidents = createRoute({
  getParentRoute: () => admin,
  path: 'incidents',
  component: lazyRouteComponent(() => import('./pages/admin/IncidentsPage.tsx'), 'IncidentsPage'),
});
const maintenance = createRoute({
  getParentRoute: () => admin,
  path: 'maintenance',
  component: lazyRouteComponent(() => import('./pages/admin/MaintenancePage.tsx'), 'MaintenancePage'),
});
const notifications = createRoute({
  getParentRoute: () => admin,
  path: 'notifications',
  component: lazyRouteComponent(() => import('./pages/admin/NotificationsPage.tsx'), 'NotificationsPage'),
});
const tokens = createRoute({
  getParentRoute: () => admin,
  path: 'tokens',
  component: lazyRouteComponent(() => import('./pages/admin/TokensPage.tsx'), 'TokensPage'),
});
const users = createRoute({
  getParentRoute: () => admin,
  path: 'users',
  component: lazyRouteComponent(() => import('./pages/admin/UsersPage.tsx'), 'UsersPage'),
});

// Sign-in and admin code (auth client, schemas) loads on demand; the public page stays small.
const routeTree = root.addChildren([
  publicLayout.addChildren([overview, service, incidentHistory, incident]),
  login,
  consent,
  admin.addChildren([adminIndex, monitors, software, incidents, maintenance, notifications, tokens, users]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
