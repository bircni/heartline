import type { Me } from '@heartline/shared';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Icon } from '../components/Icon.tsx';
import { Shell, SiteBrand } from '../components/Shell.tsx';
import { ThemeMenu } from '../components/ThemeMenu.tsx';
import { useBootstrap, useMe } from '../lib/api.ts';
import { zoneLabel } from '../lib/format.ts';

function SignedIn({ me }: { me: Me }) {
  return (
    <Shell me={me}>
      <Outlet />
    </Shell>
  );
}

/** E-mail sign-up when the site offers it, otherwise the feed. */
export function SubscribeButton() {
  const boot = useBootstrap();
  return boot.data?.subscribe.enabled && boot.data.subscribe.email ? (
    <Link to="/subscribe" className="btn">
      <Icon name="bell" size={14} /> Subscribe
    </Link>
  ) : (
    <a className="btn" href="/api/v1/incidents.atom">
      <Icon name="rss" size={14} /> Subscribe
    </a>
  );
}

/** A private status page shown to a visitor: where to sign in, instead of an error per request. */
function SignInPrompt() {
  const { href } = useLocation();
  return (
    <div className="card mx-auto mt-10 w-full max-w-[26rem] p-6 text-center">
      <Icon name="lock" size={22} className="mx-auto text-sec" />
      <h1 className="m-0 mt-3 text-xl font-semibold">Sign in to see the status</h1>
      <p className="m-0 mt-1 text-sec">This status page is private.</p>
      <a href={`/login?redirect=${encodeURIComponent(href)}`} className="btn-primary mt-5 w-full">
        Sign in
      </a>
    </div>
  );
}

/** Visitors get a plain centred page: no sidebar, sign-in in the corner. */
function Visitor({ isPrivate }: { isPrivate: boolean }) {
  const links = useBootstrap().data?.site.links ?? { header: [], footer: [] };
  return (
    <div className="mx-auto flex min-h-screen max-w-[56rem] flex-col gap-4 px-4 pt-5 pb-10 md:px-5">
      <header className="flex flex-wrap items-center gap-2.5 pb-1">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 text-text no-underline">
          <SiteBrand />
        </Link>
        {links.header.map((l) => (
          <a key={l.url} href={l.url} className="text-sec no-underline hover:text-text max-sm:hidden">
            {l.label}
          </a>
        ))}
        {!isPrivate && <SubscribeButton />}
        <Link to="/login" className="btn">
          Sign in
        </Link>
        <ThemeMenu />
      </header>
      {isPrivate ? <SignInPrompt /> : <Outlet />}
      <footer className="mt-auto flex flex-wrap justify-center gap-x-5 gap-y-1 pt-6 text-xs text-muted">
        {!isPrivate && (
          <Link to="/incidents" className="text-muted no-underline hover:text-text">
            Incident history
          </Link>
        )}
        {links.footer.map((l) => (
          <a key={l.url} href={l.url} className="text-muted no-underline hover:text-text">
            {l.label}
          </a>
        ))}
        <span>Times in {zoneLabel()}</span>
      </footer>
    </div>
  );
}

export function PublicLayout() {
  const me = useMe();
  const boot = useBootstrap();
  if (me.data) return <SignedIn me={me.data} />;
  // A private page waits for the session check, so signed-in users never see the prompt flash.
  if (boot.data?.public === false) return me.isPending ? null : <Visitor isPrivate />;
  // Public pages show at once; signed-in users switch to the sidebar when the session check returns.
  return <Visitor isPrivate={false} />;
}
