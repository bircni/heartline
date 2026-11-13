import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { type ReactNode, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmProvider } from './components/Dialog.tsx';
import { Toaster } from './components/Toast.tsx';
import { queryClient, useBootstrap } from './lib/api.ts';
import { setDisplayTimeZone } from './lib/format.ts';
import { useSiteAccent } from './lib/theme.ts';
import { router } from './router.tsx';
import './styles.css';

/**
 * Page title, colour theme and time zone from the site settings. The app renders once they are known, so
 * every timestamp is shown in the site's zone from the first paint.
 */
function Site({ children }: { children: ReactNode }) {
  const boot = useBootstrap();
  useEffect(() => {
    if (boot.data) document.title = boot.data.site.title;
  }, [boot.data]);
  useSiteAccent(boot.data?.site.theme);
  if (boot.isPending) return null;
  setDisplayTimeZone(boot.data?.site.timezone);
  return children;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <Site>
          <RouterProvider router={router} />
        </Site>
        <Toaster />
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
