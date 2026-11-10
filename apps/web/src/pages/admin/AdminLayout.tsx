import type { Role } from '@heartline/shared';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { IconName } from '../../components/Icon.tsx';
import { NavGroup, NavItem, Shell } from '../../components/Shell.tsx';
import { Spinner } from '../../components/ui.tsx';
import { useAdminMonitors, useIncidents, useMe, useSoftwareInventory } from '../../lib/api.ts';

interface Section {
  to: string;
  label: string;
  icon: IconName;
  min: Role;
}

const MANAGE: Section[] = [
  { to: '/admin/monitors', label: 'Monitors', icon: 'pulse', min: 'viewer' },
  { to: '/admin/software', label: 'Software', icon: 'shield', min: 'viewer' },
  { to: '/admin/incidents', label: 'Incidents', icon: 'alert', min: 'viewer' },
  { to: '/admin/maintenance', label: 'Maintenance', icon: 'calendar', min: 'viewer' },
  { to: '/admin/notifications', label: 'Notifications', icon: 'bell', min: 'viewer' },
];
const ACCESS: Section[] = [
  { to: '/admin/tokens', label: 'API tokens', icon: 'key', min: 'viewer' },
  { to: '/admin/users', label: 'Users', icon: 'users', min: 'admin' },
];
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export function can(role: Role | undefined, needed: Role): boolean {
  return role !== undefined && RANK[role] >= RANK[needed];
}

/** Admin navigation with the numbers that need attention next to each section. */
function AdminNav({ role }: { role: Role }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = useIncidents(true);
  const monitors = useAdminMonitors();
  const software = useSoftwareInventory();
  const urgent = software.data ? software.data.totals.critical + software.data.totals.high : 0;
  const counts: Record<string, { count?: string | number; urgent?: boolean }> = {
    '/admin/monitors': { count: monitors.data?.length },
    '/admin/software': urgent ? { count: `${urgent} urgent`, urgent: true } : {},
    '/admin/incidents': active.data?.length ? { count: `${active.data.length} open`, urgent: true } : {},
  };
  const items = (sections: Section[]) =>
    sections
      .filter((s) => can(role, s.min))
      .map((s) => (
        <NavItem
          key={s.to}
          to={s.to}
          icon={s.icon}
          label={s.label}
          current={path.startsWith(s.to)}
          {...counts[s.to]}
        />
      ));
  return (
    <>
      <NavGroup>{items(MANAGE)}</NavGroup>
      <NavGroup label="Access">{items(ACCESS)}</NavGroup>
    </>
  );
}

export function AdminLayout() {
  const me = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (me.isSuccess && !me.data) void navigate({ to: '/login' });
  }, [me.isSuccess, me.data, navigate]);

  if (!me.data) return <Spinner />;
  return (
    <Shell view="admin" me={me.data} nav={<AdminNav role={me.data.role} />}>
      <Outlet />
    </Shell>
  );
}
