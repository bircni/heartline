import { Link, Outlet } from '@tanstack/react-router';
import { SiteBrand } from '../components/Shell.tsx';
import { ThemeMenu } from '../components/ThemeMenu.tsx';

/** A centred page with the site name: for pages opened from e-mail links, private sites included. */
export function PlainLayout() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[56rem] flex-col gap-4 px-4 pt-5 pb-10 md:px-5">
      <header className="flex items-center gap-2.5 pb-1">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 text-text no-underline">
          <SiteBrand />
        </Link>
        <ThemeMenu />
      </header>
      <Outlet />
    </div>
  );
}
