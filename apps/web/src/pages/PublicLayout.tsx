import type { Me } from '@heartline/shared';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Icon } from '../components/Icon.tsx';
import { NavGroup, NavItem, Shell, SiteLogo } from '../components/Shell.tsx';
import { StatusDot } from '../components/Status.tsx';
import { ThemeMenu } from '../components/ThemeMenu.tsx';
import { useBootstrap, useIncidents, useMe, useOverview } from '../lib/api.ts';
import { rangeSearch, useRange } from './RangeControl.tsx';

/** Sidebar navigation of the status page: overview, incident history and every service. */
function StatusNav() {
  const range = useRange();
  const overview = useOverview(range);
  const active = useIncidents(true);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const open = active.data?.length ?? 0;
  return (
    <>
      <NavGroup>
        <NavItem to="/" search={rangeSearch(range)} icon="grid" label="Overview" current={path === '/'} />
        <NavItem
          to="/incidents"
          icon="alert"
          label="Incidents"
          current={path.startsWith('/incidents')}
          count={open ? `${open} open` : undefined}
          urgent
        />
      </NavGroup>
      {overview.data?.groups.map((g) => (
        <NavGroup key={g.name} label={g.name}>
          {g.services.map((s) => (
            <Link
              key={s.id}
              to="/services/$id"
              params={{ id: s.id }}
              search={rangeSearch(range)}
              aria-current={path === `/services/${s.id}` ? 'page' : undefined}
              className="nav-item"
            >
              <span className="flex w-[15px] justify-center">
                <StatusDot status={s.status} />
              </span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
            </Link>
          ))}
        </NavGroup>
      ))}
    </>
  );
}

function SignedIn({ me }: { me: Me }) {
  return (
    <Shell view="status" me={me} nav={<StatusNav />}>
      <Outlet />
    </Shell>
  );
}

/** Visitors get a plain centred page: no sidebar, sign-in in the corner. */
function Visitor() {
  const boot = useBootstrap();
  return (
    <div className="mx-auto flex min-h-screen max-w-[56rem] flex-col gap-4 px-4 pt-5 pb-10 md:px-5">
      <header className="flex flex-wrap items-center gap-2.5 pb-1">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 text-text no-underline">
          <SiteLogo />
          <span className="truncate text-[15px] font-semibold">{boot.data?.site.title ?? 'Status'}</span>
        </Link>
        <a className="btn" href="/api/v1/incidents.rss">
          <Icon name="rss" size={14} /> Subscribe
        </a>
        <Link to="/login" className="btn">
          Sign in
        </Link>
        <ThemeMenu />
      </header>
      <Outlet />
      <footer className="mt-auto flex flex-wrap justify-center gap-x-5 gap-y-1 pt-6 text-[12px] text-muted">
        <Link to="/incidents" className="text-muted no-underline hover:text-text">
          Incident history
        </Link>
        <a href="/api/v1/report.csv?days=90" className="text-muted no-underline hover:text-text">
          Uptime report (CSV)
        </a>
      </footer>
    </div>
  );
}

export function PublicLayout() {
  const me = useMe();
  // Wait for the session check so signed-in users never see the visitor page flash first.
  if (me.isPending) return null;
  return me.data ? <SignedIn me={me.data} /> : <Visitor />;
}
