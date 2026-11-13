import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmProvider } from './components/Dialog.tsx';
import { Toaster } from './components/Toast.tsx';
import { queryClient, useBootstrap } from './lib/api.ts';
import { useSiteAccent } from './lib/theme.ts';
import { router } from './router.tsx';
import './styles.css';

/** Page title and default colour theme from the site settings. */
function Site() {
  const boot = useBootstrap();
  useEffect(() => {
    if (boot.data) document.title = boot.data.site.title;
  }, [boot.data]);
  useSiteAccent(boot.data?.site.theme);
  return null;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <Site />
        <RouterProvider router={router} />
        <Toaster />
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
