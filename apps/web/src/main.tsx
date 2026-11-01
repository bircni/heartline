import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient, useBootstrap } from './lib/api.ts';
import { router } from './router.tsx';
import './styles.css';

function Title() {
  const boot = useBootstrap();
  useEffect(() => {
    if (boot.data) document.title = boot.data.site.title;
  }, [boot.data]);
  return null;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Title />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
