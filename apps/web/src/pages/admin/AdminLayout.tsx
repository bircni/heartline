import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Shell } from '../../components/Shell.tsx';
import { Spinner } from '../../components/ui.tsx';
import { useMe } from '../../lib/api.ts';

/** The admin pages share the signed-in shell; visitors are sent to sign in. */
export function AdminLayout() {
  const me = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (me.isSuccess && !me.data) void navigate({ to: '/login' });
  }, [me.isSuccess, me.data, navigate]);

  if (!me.data) return <Spinner />;
  return (
    <Shell me={me.data}>
      <Outlet />
    </Shell>
  );
}
