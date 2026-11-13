import type { Me, Role } from '@heartline/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useNavOverview, useOverview, useSoftwareInventory } from '../lib/api.ts';
import { can } from '../lib/roles.ts';
import { useRange, useRangeSearch } from '../pages/RangeControl.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { StatusDot } from './Status.tsx';

function NavItem({
  to,
  params,
  search,
  icon,
  leading,
  label,
  count,
  urgent,
  current,
}: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  icon?: IconName;
  /** Shown in the icon slot instead of `icon`, e.g. a status dot. */
  leading?: ReactNode;
  label: ReactNode;
  count?: string | number;
  urgent?: boolean;
  current: boolean;
}) {
  return (
    <Link
      to={to}
      params={params}
      search={search}
      aria-current={current ? 'page' : undefined}
      className="nav-item"
    >
      {leading ?? (icon && <Icon name={icon} size={15} className="shrink-0" />)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className={`text-xs ${urgent ? 'font-medium text-bad-text' : 'text-muted'}`}>{count}</span>
      )}
    </Link>
  );
}

function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      {label && <div className="px-2 pb-1 text-xs font-medium text-muted">{label}</div>}
      {children}
    </div>
  );
}

interface Section {
  to: string;
  label: string;
  icon: IconName;
  min: Role;
}

const MANAGE: Section[] = [
  { to: '/admin/incidents', label: 'Incidents', icon: 'alert', min: 'viewer' },
  { to: '/admin/monitors', label: 'Monitors', icon: 'pulse', min: 'viewer' },
  { to: '/admin/software', label: 'Software', icon: 'shield', min: 'viewer' },
  { to: '/admin/maintenance', label: 'Maintenance', icon: 'calendar', min: 'viewer' },
  { to: '/admin/notifications', label: 'Notifications', icon: 'bell', min: 'viewer' },
];
const ACCESS: Section[] = [
  { to: '/admin/tokens', label: 'API tokens', icon: 'key', min: 'viewer' },
  { to: '/admin/users', label: 'Users', icon: 'users', min: 'admin' },
];

/**
 * The one sidebar for signed-in users: the status overview, everything they may manage, and every service
 * with its current status. Counts mark what needs attention.
 */
export function AppNav({ me }: { me: Me }) {
  const range = useRange();
  const linkSearch = useRangeSearch();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // On the overview the page's own query serves the sidebar too; elsewhere a lighter one does.
  const page = useOverview(range, path === '/');
  const light = useNavOverview(path !== '/');
  const overview = path === '/' ? page : light;
  const software = useSoftwareInventory();
  const open = overview.data?.activeIncidents.length ?? 0;
  const urgent = software.data ? software.data.totals.critical + software.data.totals.high : 0;
  // Only counts that need attention are shown, and each says whether it is urgent.
  const counts: Record<string, { label: string; urgent: boolean } | undefined> = {
    '/admin/incidents': open ? { label: `${open} open`, urgent: true } : undefined,
    '/admin/software': urgent ? { label: `${urgent} urgent`, urgent: true } : undefined,
  };
  const items = (sections: Section[]) =>
    sections
      .filter((s) => can(me.role, s.min))
      .map((s) => (
        <NavItem
          key={s.to}
          to={s.to}
          icon={s.icon}
          label={s.label}
          current={path.startsWith(s.to)}
          count={counts[s.to]?.label}
          urgent={counts[s.to]?.urgent}
        />
      ));

  return (
    <>
      <NavGroup>
        <NavItem to="/" search={linkSearch} icon="grid" label="Overview" current={path === '/'} />
        {items(MANAGE)}
      </NavGroup>
      <NavGroup label="Access">{items(ACCESS)}</NavGroup>
      {[...(overview.data?.groups ?? []), ...(overview.data?.external ?? [])].map((g, i) => (
        <NavGroup key={`${i}-${g.name}`} label={g.name}>
          {g.services.map((s) => (
            <NavItem
              key={s.id}
              to="/services/$id"
              params={{ id: s.id }}
              search={linkSearch}
              leading={
                <span className="flex w-[15px] justify-center">
                  <StatusDot status={s.status} />
                </span>
              }
              label={s.name}
              current={path === `/services/${s.id}`}
            />
          ))}
        </NavGroup>
      ))}
    </>
  );
}
