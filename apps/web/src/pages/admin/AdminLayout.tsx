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
    <div className="flex min-h-screen flex-col md:flex-row md:items-start">
      <aside className="box-border w-full bg-side px-2.5 py-3.5 md:sticky md:top-0 md:h-screen md:w-[240px] md:shrink-0 md:overflow-y-auto md:border-r md:border-hair">
        <div className="flex items-center justify-between px-1.5">
          <Link to="/" className="flex items-center gap-2.5 text-text no-underline">
            <Logo />
            <span className="text-[15px] font-semibold">{boot.data?.site.title ?? 'Status'}</span>
            <span className="text-[12px] text-sec">Admin</span>
          </Link>
          <ThemeButton />
        </div>
        <nav aria-label="Admin sections" className="mt-4">
          {SECTIONS.filter((s) => can(me.data?.role, s.min)).map((s) => {
            const current = path.startsWith(s.to);
            const count = s.to === '/admin/incidents' ? active.data?.length : undefined;
            return (
              <Link
                key={s.to}
                to={s.to}
                aria-current={current ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-text no-underline hover:bg-hover ${current ? 'bg-sel' : ''}`}
              >
                <Icon name={s.icon} size={16} className="text-sec" />
                <span className="flex-1 font-medium">{s.label}</span>
                {count ? <span className="text-[12px] text-sec">{count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <Link
          to="/"
          className="mx-1.5 mt-3 flex items-center gap-2 rounded-[9px] px-1 py-1.5 text-[13px] text-sec no-underline hover:text-text"
        >
          <Icon name="external" size={14} /> View status page
        </Link>
        <div className="mx-1.5 mt-4 flex items-center gap-2.5 border-t border-hair px-1 pt-3">
          {me.data.image ? (
            <img src={me.data.image} alt="" className="h-[30px] w-[30px] rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-fill-2 text-[13px] font-semibold"
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
            className="rounded-[7px] px-2 py-1.5 text-[12px] text-sec hover:bg-hover hover:text-text"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="box-border min-w-0 flex-1 px-4 py-4 md:px-8 md:py-5">
        <Outlet />
      </main>
    </div>
  );
}
