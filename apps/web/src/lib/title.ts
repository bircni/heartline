import { useEffect } from 'react';
import { useBootstrap } from './api.ts';

/** Sets the tab title to "<page> · <site>", or the site title alone. */
export function usePageTitle(page?: string | null) {
  const site = useBootstrap().data?.site.title;
  useEffect(() => {
    if (!site) return;
    document.title = page && page !== site ? `${page} · ${site}` : site;
  }, [page, site]);
}
