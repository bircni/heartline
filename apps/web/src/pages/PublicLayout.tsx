import type { Overview } from '@heartline/shared';
import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { Icon, Logo } from '../components/Icon.tsx';
import { StatusDot } from '../components/Status.tsx';
import { useBootstrap, useMe, useOverview } from '../lib/api.ts';
import { pct, relative } from '../lib/format.ts';
import { useTheme } from '../lib/theme.ts';

export function ThemeButton() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-sec hover:bg-hover hover:text-text"
    >
      <Icon name="moon" size={15} />
    </button>
  );
}

function OverallCard({ overview }: { overview: Overview }) {
  return (
    <div className="card mx-1.5 mt-4 px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <StatusDot status={overview.status} size={9} halo />
        <span className="font-semibold">{overview.headline}</span>
      </div>
      <div className="ml-[19px] mt-1 text-[12px] text-sec">
        {overview.operational} of {overview.total} operational · updated {relative(overview.generatedAt)}
      </div>
    </div>
  );
}

export function PublicLayout() {
  const { days } = useSearch({ strict: false }) as { days?: number };
  const range = days ?? 90;
  const overview = useOverview(range);
  const boot = useBootstrap();
  const me = useMe();
  const [q, setQ] = useState('');
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const filter = q.trim().toLowerCase();

  return (
    <div className="flex min-h-screen flex-col md:flex-row md:items-start">
      {/* On phones the status comes first and the service list follows. */}
      <div className="flex w-full items-center justify-between px-5 pt-4 md:hidden">
        <Link to="/" search={{ days: range }} className="flex items-center gap-2.5 text-text no-underline">
          <Logo />
          <span className="text-[15px] font-semibold">{boot.data?.site.title ?? 'Status'}</span>
        </Link>
        <ThemeButton />
      </div>
      <aside className="order-last box-border w-full bg-side px-2.5 py-3.5 md:sticky md:top-0 md:order-none md:h-screen md:w-[280px] md:shrink-0 md:overflow-y-auto md:border-r md:border-hair">
        <div className="hidden items-center justify-between px-1.5 md:flex">
          <Link to="/" search={{ days: range }} className="flex items-center gap-2.5 text-text no-underline">
            {boot.data?.site.logoUrl ? (
              <img
                src={boot.data.site.logoUrl}
                alt=""
                className="h-[26px] w-[26px] rounded-[7px] object-cover"
              />
            ) : (
              <Logo />
            )}
            <span className="text-[15px] font-semibold">{boot.data?.site.title ?? 'Status'}</span>
          </Link>
          <ThemeButton />
        </div>

        {overview.data && <OverallCard overview={overview.data} />}

        <label htmlFor="svc-filter" className="sr-only">
          Filter services
        </label>
        <div className="mx-1.5 mt-3 flex h-8 items-center gap-2 rounded-[9px] bg-fill px-2.5">
          <Icon name="search" size={14} className="shrink-0 text-sec" />
          <input
            id="svc-filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter services"
            className="h-[30px] min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text outline-none"
          />
        </div>

        <nav aria-label="Services" className="mt-2">
          <Link
            to="/"
            search={{ days: range }}
            className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-text no-underline hover:bg-hover ${path === '/' ? 'bg-sel' : ''}`}
            aria-current={path === '/' ? 'page' : undefined}
          >
            <Icon name="list" size={14} className="text-sec" />
            <span className="flex-1 font-medium">Overview</span>
            <span className="text-[12px] text-sec">{overview.data?.total ?? ''}</span>
          </Link>
          {overview.data?.groups.map((g) => {
            const services = g.services.filter((s) => !filter || s.name.toLowerCase().includes(filter));
            if (services.length === 0) return null;
            return (
              <div key={g.name}>
                <div className="px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-sec">
                  {g.name}
                </div>
                {services.map((s) => {
                  const current = path === `/services/${s.id}`;
                  return (
                    <Link
                      key={s.id}
                      to="/services/$id"
                      params={{ id: s.id }}
                      search={{ days: range }}
                      aria-current={current ? 'page' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-text no-underline hover:bg-hover ${current ? 'bg-sel' : ''}`}
                    >
                      <StatusDot status={s.status} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="text-[12px] text-sec">{pct(s.uptime)}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {overview.data && overview.data.upcomingMaintenance.length > 0 && (
          <div className="mx-1.5 mt-4 border-t border-hair pt-3.5">
            <div className="px-1 text-[11px] font-semibold uppercase text-sec">
              {overview.data.upcomingMaintenance.some((m) => m.active) ? 'Maintenance' : 'Upcoming'}
            </div>
            {overview.data.upcomingMaintenance.slice(0, 3).map((m) => {
              const start = new Date(m.nextStartsAt ?? m.startsAt);
              return (
                <div key={m.id} className="flex gap-2.5 px-1 pt-2">
                  <span className="w-9 shrink-0 rounded-lg bg-fill py-0.5 text-center">
                    <span className="block text-[9px] font-semibold uppercase text-sec">
                      {start.toLocaleString(undefined, { month: 'short' })}
                    </span>
                    <span className="block text-[15px] font-semibold leading-[1.1]">{start.getDate()}</span>
                  </span>
                  <span className="min-w-0 text-[13px]">
                    <span className="block truncate font-medium">{m.title}</span>
                    <span className="block text-[12px] text-sec">
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

        <div className="mx-2.5 mt-5 flex flex-wrap gap-3.5 text-[12px]">
          <a className="text-sec no-underline hover:text-text" href="/api/v1/incidents.rss">
            RSS
          </a>
          <a className="text-sec no-underline hover:text-text" href="/api/v1/report.csv?days=90">
            CSV
          </a>
          {me.data ? (
            <button
              type="button"
              className="text-sec hover:text-text"
              onClick={() => void navigate({ to: '/admin' })}
            >
              Admin
            </button>
          ) : (
            <Link to="/login" className="text-sec no-underline hover:text-text">
              Sign in
            </Link>
          )}
        </div>
      </aside>

      <main className="box-border min-w-0 flex-1 px-4 py-4 md:px-8 md:py-5">
        <Outlet />
      </main>
    </div>
  );
}
