import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Icon, Logo } from '../components/Icon.tsx';
import { StatusDot } from '../components/Status.tsx';
import { useBootstrap, useMe, useOverview } from '../lib/api.ts';
import { useTheme } from '../lib/theme.ts';

const BAR_LINK =
  'flex h-8 items-center rounded-[6px] px-2.5 text-[13px] text-sec no-underline transition-colors hover:bg-hover hover:text-text';

export function ThemeButton() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-sec transition-colors hover:bg-hover hover:text-text"
    >
      <Icon name={dark ? 'sun' : 'moon'} size={16} />
    </button>
  );
}

function Brand({ days }: { days: number | undefined }) {
  const boot = useBootstrap();
  return (
    <Link to="/" search={{ days }} className="flex min-w-0 items-center gap-2.5 text-text no-underline">
      {boot.data?.site.logoUrl ? (
        <img src={boot.data.site.logoUrl} alt="" className="h-6 w-6 shrink-0 rounded-[6px] object-cover" />
      ) : (
        <Logo />
      )}
      <span className="truncate text-[15px] font-semibold">{boot.data?.site.title ?? 'Status'}</span>
    </Link>
  );
}

export function PublicLayout() {
  const { days } = useSearch({ strict: false }) as { days?: number };
  const overview = useOverview(days ?? 90);
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const groups = overview.data?.groups ?? [];
  const serviceId = path.startsWith('/services/')
    ? decodeURIComponent(path.slice('/services/'.length))
    : null;
  const listed = serviceId !== null && groups.some((g) => g.services.some((s) => s.id === serviceId));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="gutter flex h-14 shrink-0 items-center gap-2 border-b border-hair">
        <Brand days={path === '/' ? days : undefined} />

        {/* On a service page the bar doubles as the way to the next service. */}
        {listed && (
          <>
            <span aria-hidden="true" className="text-[16px] text-fill-2">
              /
            </span>
            <label className="relative flex min-w-0 items-center">
              <span className="sr-only">Service</span>
              <select
                value={serviceId}
                onChange={(e) =>
                  void navigate({ to: '/services/$id', params: { id: e.target.value }, search: { days } })
                }
                className="h-8 min-w-0 max-w-[42vw] cursor-pointer appearance-none truncate rounded-[6px] [field-sizing:content] border-0 bg-transparent py-0 pl-2 pr-7 text-[14px] font-medium text-text transition-colors hover:bg-hover"
              >
                {groups.map((g) => (
                  <optgroup key={g.name} label={g.name}>
                    {g.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Icon
                name="chevronDown"
                size={14}
                className="pointer-events-none absolute right-2 text-muted"
              />
            </label>
          </>
        )}

        <span className="flex-1" />

        {/* The overview states the overall status itself; everywhere else it stays one glance away. */}
        {overview.data && path !== '/' && (
          <Link to="/" className={`${BAR_LINK} min-w-0 gap-2 max-sm:hidden`}>
            <StatusDot status={overview.data.status} />
            <span className="truncate">{overview.data.headline}</span>
          </Link>
        )}
        {me.data ? (
          <button type="button" className={BAR_LINK} onClick={() => void navigate({ to: '/admin' })}>
            Admin
          </button>
        ) : (
          <Link to="/login" className={`${BAR_LINK} whitespace-nowrap`}>
            Sign in
          </Link>
        )}
        <ThemeButton />
      </header>

      <main className="gutter flex-1 pb-12 pt-6 md:pt-8">
        <Outlet />
      </main>

      <footer className="gutter flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hair py-4 text-[12px]">
        <a
          className="flex items-center gap-1.5 text-muted no-underline transition-colors hover:text-text"
          href="/api/v1/incidents.rss"
        >
          <Icon name="rss" size={14} /> Incident feed
        </a>
        <a
          className="flex items-center gap-1.5 text-muted no-underline transition-colors hover:text-text"
          href="/api/v1/report.csv?days=90"
        >
          <Icon name="download" size={14} /> Uptime report, 90 days (CSV)
        </a>
      </footer>
    </div>
  );
}
