import type { Me } from '@heartline/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useBootstrap } from '../lib/api.ts';
import { Icon, type IconName } from './Icon.tsx';
import { usePopover } from './Popover.tsx';
import { ThemeMenu } from './ThemeMenu.tsx';

export type ShellView = 'status' | 'admin';

const VIEWS: { view: ShellView; to: string; label: string; hint: string }[] = [
  { view: 'status', to: '/', label: 'Status page', hint: 'What visitors see' },
  { view: 'admin', to: '/admin', label: 'Admin', hint: 'Monitors, incidents and access' },
];

export function SiteLogo({ size = 26 }: { size?: number }) {
  const boot = useBootstrap();
  const url = boot.data?.site.logoUrl;
  if (url)
    return (
      <img
        src={url}
        alt=""
        className="shrink-0 rounded-md object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-md bg-accent text-on-accent"
      style={{ width: size, height: size }}
    >
      <Icon name="pulse" size={size * 0.62} strokeWidth={2.4} />
    </span>
  );
}

/** Top-left switch between the status page and the admin area. */
function ViewSwitcher({ view }: { view: ShellView }) {
  const boot = useBootstrap();
  const { ref: popRef, ...pop } = usePopover();
  const current = VIEWS.find((v) => v.view === view) as (typeof VIEWS)[number];
  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        onClick={pop.toggle}
        className={`flex h-[46px] w-full items-center gap-2.5 rounded-lg border bg-surface px-2 text-left transition-colors hover:bg-hover ${pop.open ? 'border-accent' : 'border-hair'}`}
      >
        <SiteLogo />
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-tight font-semibold">
            {boot.data?.site.title ?? 'Status'}
          </span>
          <span className="block text-[12px] leading-tight text-muted">{current.label}</span>
        </span>
        <Icon name="updown" size={14} className="text-muted" />
      </button>
      {pop.open && (
        <div role="menu" className="popover inset-x-0 top-[50px]">
          {VIEWS.map((v) => (
            <Link
              key={v.view}
              to={v.to}
              role="menuitem"
              onClick={() => pop.setOpen(false)}
              className={`menu-item ${v.view === view ? 'bg-fill' : ''}`}
            >
              <span className="flex-1">
                <span className="block font-medium">{v.label}</span>
                <span className="block text-[12px] text-muted">{v.hint}</span>
              </span>
              {v.view === view && <Icon name="check" size={15} />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** The signed-in user at the bottom of the sidebar, with sign out. */
function UserMenu({ me }: { me: Me }) {
  const { ref: popRef, ...pop } = usePopover();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    // The auth client stays out of the public bundle until someone signs out.
    const { authClient } = await import('../lib/auth.ts');
    await authClient.signOut();
    qc.clear();
    void navigate({ to: '/' });
  };
  return (
    <div ref={popRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        onClick={pop.toggle}
        className="flex h-11 w-full items-center gap-[9px] rounded-md px-1.5 text-left transition-colors hover:bg-fill"
      >
        {me.image ? (
          <img src={me.image} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fill-2 text-[11.5px] font-semibold"
          >
            {initials(me.name)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-tight font-medium">{me.name}</span>
          <span className="block truncate text-[12px] leading-tight text-muted">{me.email}</span>
        </span>
      </button>
      {pop.open && (
        <div role="menu" className="popover inset-x-0 bottom-12">
          <div className="px-2 py-1.5 text-[12px] text-muted">
            Signed in as <span className="capitalize">{me.role}</span>
          </div>
          <button type="button" role="menuitem" className="menu-item" onClick={() => void signOut()}>
            <Icon name="logout" size={15} className="text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function NavItem({
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
        <span className={`text-[12px] ${urgent ? 'font-medium text-bad-text' : 'text-muted'}`}>{count}</span>
      )}
    </Link>
  );
}

export function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      {label && <div className="px-2 pb-1 text-[12px] font-medium text-muted">{label}</div>}
      {children}
    </div>
  );
}

/**
 * Sidebar layout for signed-in users, shared by the status page and the admin area: the view switcher at the
 * top, the view's navigation, and the user with the theme menu at the bottom. On phones the sidebar opens
 * from a menu button.
 */
export function Shell({
  view,
  me,
  nav,
  children,
}: {
  view: ShellView;
  me: Me;
  nav: ReactNode;
  children: ReactNode;
}) {
  const boot = useBootstrap();
  // The phone menu belongs to the page it was opened on, so following a link closes it.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex h-12 items-center gap-2.5 border-b border-hair bg-side px-3 md:hidden">
        <SiteLogo size={24} />
        <span className="min-w-0 flex-1 truncate font-semibold">{boot.data?.site.title ?? 'Status'}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpenOn(open ? null : path)}
        >
          <Icon name={open ? 'x' : 'menu'} size={18} />
        </button>
      </div>
      <aside
        className={`${open ? 'flex' : 'hidden'} flex-col gap-3.5 border-hair bg-side p-2.5 max-md:border-b md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r`}
      >
        <ViewSwitcher view={view} />
        <div className="flex flex-col gap-3.5">{nav}</div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 border-t border-hair pt-2.5">
          <UserMenu me={me} />
          <ThemeMenu placement="above" />
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
