import type { Role } from '@heartline/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Icon, type IconName, Logo } from '../../components/Icon.tsx';
import { Spinner } from '../../components/ui.tsx';
import { useBootstrap, useIncidents, useMe } from '../../lib/api.ts';
import { authClient } from '../../lib/auth.ts';
import { ThemeButton } from '../PublicLayout.tsx';

const SECTIONS: { to: string; label: string; icon: IconName; min: Role }[] = [
  { to: '/admin/monitors', label: 'Monitors', icon: 'pulse', min: 'viewer' },
  { to: '/admin/incidents', label: 'Incidents', icon: 'alert', min: 'viewer' },
  { to: '/admin/maintenance', label: 'Maintenance', icon: 'wrench', min: 'viewer' },
  { to: '/admin/notifications', label: 'Notifications', icon: 'bell', min: 'viewer' },
  { to: '/admin/tokens', label: 'API tokens', icon: 'key', min: 'viewer' },
  { to: '/admin/users', label: 'Users', icon: 'users', min: 'admin' },
];
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export function can(role: Role | undefined, needed: Role): boolean {
  return role !== undefined && RANK[role] >= RANK[needed];
}

export function AdminLayout() {
  const me = useMe();
  const boot = useBootstrap();
  const active = useIncidents(true);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (me.isSuccess && !me.data) void navigate({ to: '/login' });
  }, [me.isSuccess, me.data, navigate]);

  if (!me.data) return <Spinner />;
  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    void navigate({ to: '/' });
  };

  return (
    <div className="app-shell">
      <aside className="app-rail border-b md:w-60 md:border-b-0">
        <div className="flex items-center justify-between pl-3 pr-1">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-text no-underline">
            <Logo />
            <span className="truncate text-[16px] font-medium">{boot.data?.site.title ?? 'Status'}</span>
            <span className="text-[12px] text-muted">Admin</span>
          </Link>
          <ThemeButton />
        </div>
        <nav aria-label="Admin sections" className="mt-4 flex flex-col gap-0.5">
          {SECTIONS.filter((s) => can(me.data?.role, s.min)).map((s) => {
            const current = path.startsWith(s.to);
            const count = s.to === '/admin/incidents' ? active.data?.length : undefined;
            return (
              <Link
                key={s.to}
                to={s.to}
                aria-current={current ? 'page' : undefined}
                className={`flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-text no-underline transition-colors hover:bg-hover ${current ? 'bg-sel' : ''}`}
              >
                <Icon name={s.icon} size={16} className="shrink-0 text-muted" />
                <span className="flex-1">{s.label}</span>
                {count ? <span className="font-mono text-[12px] text-muted">{count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <Link
          to="/"
          className="mt-2 flex h-9 items-center gap-2 rounded-[8px] px-3 text-[13px] text-sec no-underline transition-colors hover:bg-hover hover:text-text"
        >
          <Icon name="external" size={16} /> View status page
        </Link>
        <div className="mx-3 mt-4 flex items-center gap-2 border-t border-hair pt-4">
          {me.data.image ? (
            <img src={me.data.image} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-fill-2 text-[13px] font-medium"
            >
              {me.data.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{me.data.name}</span>
            <span className="block text-[12px] capitalize text-sec">{me.data.role}</span>
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-8 rounded-[8px] px-2 text-[12px] text-sec transition-colors hover:bg-hover hover:text-text"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
