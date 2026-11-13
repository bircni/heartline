import { MAX_RANGE_DAYS, isDayKey } from '@heartline/shared';
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { meQueryOptions, queryClient } from './lib/api.ts';
import { can } from './lib/roles.ts';
import { IncidentHistoryPage, IncidentPage } from './pages/IncidentPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { PublicLayout } from './pages/PublicLayout.tsx';
import { ServicePage } from './pages/ServicePage.tsx';

type RangeSearch = { days?: number; to?: string };
const validateRange = (search: Record<string, unknown>): RangeSearch => {
  const days = Number(search.days);
  const to = typeof search.to === 'string' && isDayKey(search.to) ? search.to : undefined;
  return {
    ...(Number.isInteger(days) && days >= 1 && days <= MAX_RANGE_DAYS ? { days } : {}),
    ...(to ? { to } : {}),
  };
};

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="m-0 text-xl font-semibold">Page not found</h1>
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
const maintenanceWindow = createRoute({
  getParentRoute: () => publicLayout,
  path: 'maintenance/$id',
  component: lazyRouteComponent(() => import('./pages/MaintenancePage.tsx'), 'MaintenanceWindowPage'),
});
const incident = createRoute({
  getParentRoute: () => publicLayout,
  path: 'incidents/$id',
  component: IncidentPage,
});

const subscribe = createRoute({
  getParentRoute: () => publicLayout,
  path: 'subscribe',
  validateSearch: (search: Record<string, unknown>): { incident?: string } =>
    typeof search.incident === 'string' && search.incident ? { incident: search.incident } : {},
  component: lazyRouteComponent(() => import('./pages/SubscriptionPages.tsx'), 'SubscribePage'),
});

/** Pages opened from subscriber e-mails: they work without signing in, also on private status pages. */
const plain = createRoute({
  getParentRoute: () => root,
  id: 'plain',
  component: lazyRouteComponent(() => import('./pages/PlainLayout.tsx'), 'PlainLayout'),
});
const subscriptionConfirm = createRoute({
  getParentRoute: () => plain,
  path: 'subscriptions/confirm',
  component: lazyRouteComponent(() => import('./pages/SubscriptionPages.tsx'), 'ConfirmPage'),
});
const subscriptionManage = createRoute({
  getParentRoute: () => plain,
  path: 'subscriptions/manage',
  validateSearch: (search: Record<string, unknown>): { t?: string; unsubscribe?: string } => ({
    ...(typeof search.t === 'string' ? { t: search.t } : {}),
    ...(search.unsubscribe ? { unsubscribe: '1' } : {}),
  }),
  component: lazyRouteComponent(() => import('./pages/SubscriptionPages.tsx'), 'ManagePage'),
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
const groups = createRoute({
  getParentRoute: () => admin,
  path: 'groups',
  component: lazyRouteComponent(() => import('./pages/admin/GroupsPage.tsx'), 'GroupsPage'),
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
  validateSearch: (search: Record<string, unknown>): { incident?: string } =>
    typeof search.incident === 'string' && search.incident ? { incident: search.incident } : {},
  component: lazyRouteComponent(() => import('./pages/admin/IncidentsPage.tsx'), 'IncidentsPage'),
});
const templates = createRoute({
  getParentRoute: () => admin,
  path: 'templates',
  component: lazyRouteComponent(() => import('./pages/admin/TemplatesPage.tsx'), 'TemplatesPage'),
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
  // The nav hides Users from non-admins; a typed or bookmarked URL is redirected as well.
  beforeLoad: async () => {
    const me = await queryClient.ensureQueryData(meQueryOptions);
    if (me && !can(me.role, 'admin')) throw redirect({ to: '/admin/monitors' });
  },
  component: lazyRouteComponent(() => import('./pages/admin/UsersPage.tsx'), 'UsersPage'),
});

const subscribers = createRoute({
  getParentRoute: () => admin,
  path: 'subscribers',
  beforeLoad: async () => {
    const me = await queryClient.ensureQueryData(meQueryOptions);
    if (me && !can(me.role, 'admin')) throw redirect({ to: '/admin/monitors' });
  },
  component: lazyRouteComponent(() => import('./pages/admin/SubscribersPage.tsx'), 'SubscribersPage'),
});
const audit = createRoute({
  getParentRoute: () => admin,
  path: 'audit',
  beforeLoad: async () => {
    const me = await queryClient.ensureQueryData(meQueryOptions);
    if (me && !can(me.role, 'admin')) throw redirect({ to: '/admin/monitors' });
  },
  component: lazyRouteComponent(() => import('./pages/admin/AuditPage.tsx'), 'AuditPage'),
});

// Sign-in and admin code (auth client, schemas) loads on demand; the public page stays small.
const routeTree = root.addChildren([
  publicLayout.addChildren([overview, service, incidentHistory, incident, maintenanceWindow, subscribe]),
  plain.addChildren([subscriptionConfirm, subscriptionManage]),
  login,
  consent,
  admin.addChildren([
    adminIndex,
    monitors,
    groups,
    software,
    incidents,
    templates,
    maintenance,
    notifications,
    tokens,
    users,
    subscribers,
    audit,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
