import type { Me } from '@heartline/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useBootstrap, useSiteTitle } from '../lib/api.ts';
import { Icon } from './Icon.tsx';
import { usePopover } from './Popover.tsx';
import { ThemeMenu } from './ThemeMenu.tsx';
import { AppNav } from './AppNav.tsx';
import { Avatar } from './ui.tsx';

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

/** Logo and site title, the brand at the top of every layout. */
export function SiteBrand({ size = 26 }: { size?: number }) {
  return (
    <>
      <SiteLogo size={size} />
      <span className="min-w-0 flex-1 truncate text-lg font-semibold">{useSiteTitle()}</span>
    </>
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
        <Avatar name={me.name} image={me.image} />
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-tight font-medium">{me.name}</span>
          <span className="block truncate text-xs leading-tight text-muted">{me.email}</span>
        </span>
      </button>
      {pop.open && (
        <div role="menu" className="popover inset-x-0 bottom-12">
          <div className="px-2 py-1.5 text-xs text-muted">
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

/**
 * Layout for signed-in users: the site at the top left, one sidebar with everything they can see and manage,
 * and the user with the theme menu at the bottom. On phones the sidebar opens from a menu button.
 */
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  // The phone menu belongs to the page it was opened on, so following a link closes it.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex h-12 items-center gap-2.5 border-b border-hair bg-side px-3 md:hidden">
        <SiteBrand size={24} />
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
        <Link to="/" className="flex h-10 items-center gap-2.5 px-1.5 text-text no-underline max-md:hidden">
          <SiteBrand />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-3.5">
          <AppNav me={me} />
        </nav>
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
