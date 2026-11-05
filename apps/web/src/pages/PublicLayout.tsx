import type { Overview } from '@heartline/shared';
import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { Icon, Logo } from '../components/Icon.tsx';
import { StatusDot } from '../components/Status.tsx';
import { useBootstrap, useMe, useOverview } from '../lib/api.ts';
import { pct, relative } from '../lib/format.ts';
import { useTheme } from '../lib/theme.ts';

const NAV_ROW =
  'flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-text no-underline transition-colors hover:bg-hover';

export function ThemeButton() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-sec transition-colors hover:bg-hover hover:text-text"
    >
      <Icon name="moon" size={16} />
    </button>
  );
}

function Brand({ range }: { range: number }) {
  const boot = useBootstrap();
  return (
    <Link to="/" search={{ days: range }} className="flex items-center gap-2 text-text no-underline">
      {boot.data?.site.logoUrl ? (
        <img src={boot.data.site.logoUrl} alt="" className="h-6 w-6 rounded-[6px] object-cover" />
      ) : (
        <Logo />
      )}
      <span className="text-[16px] font-medium">{boot.data?.site.title ?? 'Status'}</span>
    </Link>
  );
}

/** Overall status for pages that don't show it themselves. */
function OverallStatus({ overview }: { overview: Overview }) {
  return (
    <div className="mt-4 px-3">
      <div className="flex items-center gap-2">
        <span className="flex w-4 shrink-0 justify-center">
          <StatusDot status={overview.status} />
        </span>
        <span className="font-medium">{overview.headline}</span>
      </div>
      <div className="ml-6 mt-0.5 text-[12px] text-muted">
        {overview.operational} of {overview.total} operational · updated {relative(overview.generatedAt)}
      </div>
    </div>
  );
}

export function PublicLayout() {
  const { days } = useSearch({ strict: false }) as { days?: number };
  const range = days ?? 90;
  const overview = useOverview(range);
  const me = useMe();
  const [q, setQ] = useState('');
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const filter = q.trim().toLowerCase();

  return (
    <div className="app-shell">
      {/* On phones the status comes first and the service list follows. */}
      <div className="flex items-center justify-between px-4 pt-4 md:hidden">
        <Brand range={range} />
        <ThemeButton />
      </div>
      <aside className="app-rail order-last border-t md:order-none md:w-70 md:border-t-0">
        <div className="hidden items-center justify-between pl-3 pr-1 md:flex">
          <Brand range={range} />
          <ThemeButton />
        </div>

        {overview.data && path !== '/' && <OverallStatus overview={overview.data} />}

        <label htmlFor="svc-filter" className="sr-only">
          Filter services
        </label>
        <div className="mt-4 flex h-8 items-center gap-2 rounded-[8px] bg-fill px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus)">
          <Icon name="search" size={16} className="shrink-0 text-muted" />
          <input
            id="svc-filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter services"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text outline-none"
          />
        </div>

        <nav aria-label="Services" className="mt-2">
          <Link
            to="/"
            search={{ days: range }}
            className={`${NAV_ROW} ${path === '/' ? 'bg-sel' : ''}`}
            aria-current={path === '/' ? 'page' : undefined}
          >
            <Icon name="list" size={16} className="shrink-0 text-muted" />
            <span className="flex-1">Overview</span>
            <span className="font-mono text-[12px] text-muted">{overview.data?.total ?? ''}</span>
          </Link>
          {overview.data?.groups.map((g) => {
            const services = g.services.filter((s) => !filter || s.name.toLowerCase().includes(filter));
            if (services.length === 0) return null;
            return (
              <div key={g.name}>
                <div className="px-3 pb-1 pt-6 text-[12px] text-muted">{g.name}</div>
                <div className="flex flex-col gap-0.5">
                  {services.map((s) => {
                    const current = path === `/services/${s.id}`;
                    return (
                      <Link
                        key={s.id}
                        to="/services/$id"
                        params={{ id: s.id }}
                        search={{ days: range }}
                        aria-current={current ? 'page' : undefined}
                        className={`${NAV_ROW} ${current ? 'bg-sel' : ''}`}
                      >
                        <span className="flex w-4 shrink-0 justify-center">
                          <StatusDot status={s.status} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="font-mono text-[12px] text-muted">{pct(s.uptime)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {overview.data && overview.data.upcomingMaintenance.length > 0 && (
          <div className="mx-3 mt-6 border-t border-hair pt-4">
            <div className="text-[12px] text-muted">
              {overview.data.upcomingMaintenance.some((m) => m.active) ? 'Maintenance' : 'Upcoming'}
            </div>
            {overview.data.upcomingMaintenance.slice(0, 3).map((m) => {
              const start = new Date(m.nextStartsAt ?? m.startsAt);
              return (
                <div key={m.id} className="mt-2 flex gap-3">
                  <span className="w-10 shrink-0 rounded-[6px] bg-fill py-1 text-center">
                    <span className="block text-[12px] leading-4 text-muted">
                      {start.toLocaleString(undefined, { month: 'short' })}
                    </span>
                    <span className="block font-medium leading-4">{start.getDate()}</span>
                  </span>
                  <span className="min-w-0 text-[13px]">
                    <span className="block truncate">{m.title}</span>
                    <span className="block font-mono text-[12px] text-muted">
                      {m.active
                        ? 'in progress'
                        : `${start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} – ${new Date(m.nextEndsAt ?? m.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mx-3 mt-6 flex flex-wrap gap-4 text-[12px]">
          <a
            className="text-muted no-underline transition-colors hover:text-text"
            href="/api/v1/incidents.rss"
          >
            RSS
          </a>
          <a
            className="text-muted no-underline transition-colors hover:text-text"
            href="/api/v1/report.csv?days=90"
          >
            CSV
          </a>
          {me.data ? (
            <button
              type="button"
              className="text-muted transition-colors hover:text-text"
              onClick={() => void navigate({ to: '/admin' })}
            >
              Admin
            </button>
          ) : (
            <Link to="/login" className="text-muted no-underline transition-colors hover:text-text">
              Sign in
            </Link>
          )}
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
