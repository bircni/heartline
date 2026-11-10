import type { Me } from '@heartline/shared';
import { Link, Outlet } from '@tanstack/react-router';
import { Icon } from '../components/Icon.tsx';
import { Shell, SiteBrand } from '../components/Shell.tsx';
import { ThemeMenu } from '../components/ThemeMenu.tsx';
import { rangeQuery, useMe } from '../lib/api.ts';
import { useRange } from './RangeControl.tsx';

function SignedIn({ me }: { me: Me }) {
  return (
    <Shell me={me}>
      <Outlet />
    </Shell>
  );
}

/** Visitors get a plain centred page: no sidebar, sign-in in the corner. */
function Visitor() {
  const range = useRange();
  return (
    <div className="mx-auto flex min-h-screen max-w-[56rem] flex-col gap-4 px-4 pt-5 pb-10 md:px-5">
      <header className="flex flex-wrap items-center gap-2.5 pb-1">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 text-text no-underline">
          <SiteBrand />
        </Link>
        <a className="btn" href="/api/v1/incidents.rss">
          <Icon name="rss" size={14} /> Subscribe
        </a>
        <Link to="/login" className="btn">
          Sign in
        </Link>
        <ThemeMenu />
      </header>
      <Outlet />
      <footer className="mt-auto flex flex-wrap justify-center gap-x-5 gap-y-1 pt-6 text-[12px] text-muted">
        <Link to="/incidents" className="text-muted no-underline hover:text-text">
          Incident history
        </Link>
        <a
          href={`/api/v1/report.csv?${rangeQuery(range)}`}
          className="text-muted no-underline hover:text-text"
        >
          Uptime report (CSV)
        </a>
      </footer>
    </div>
  );
}

export function PublicLayout() {
  const me = useMe();
  // Visitors get the page at once; signed-in users switch to the sidebar when the session check returns.
  return me.data ? <SignedIn me={me.data} /> : <Visitor />;
}
