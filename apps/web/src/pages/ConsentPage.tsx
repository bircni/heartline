import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Logo } from '../components/Icon.tsx';
import { Notice } from '../components/ui.tsx';
import { api, useMe } from '../lib/api.ts';
import { authClient } from '../lib/auth.ts';

const SCOPE_TEXT: Record<string, string> = {
  openid: 'Know who you are',
  profile: 'See your name',
  email: 'See your e-mail address',
  offline_access: 'Stay connected without asking again',
  'status:read': 'Read services, uptime and incidents',
  'status:write': 'Post incidents, schedule maintenance and run checks',
  'status:admin': 'Manage monitors and test plugins',
};

export function ConsentPage() {
  const params = new URLSearchParams(window.location.search);
  const clientId = params.get('client_id') ?? '';
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQuery({
    queryKey: ['oauth-client', clientId],
    queryFn: () =>
      api<{ client_name?: string; client_uri?: string }>(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
      ),
    enabled: Boolean(clientId),
    refetchInterval: false,
  });

  const decide = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    const res = await authClient.$fetch<{ url?: string }>('/oauth2/consent', {
      method: 'POST',
      body: { accept },
    });
    if (res.error || !res.data?.url) {
      setBusy(false);
      setError(res.error?.message ?? 'Could not complete the authorization.');
      return;
    }
    window.location.assign(res.data.url);
  };

  const name = client.data?.client_name ?? (client.isPending && clientId ? null : 'An application');
  return (
    <div className="flex min-h-screen justify-center px-4 pb-20 pt-[12vh]">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="title m-0 mt-5 text-[24px]">{name ? `Allow ${name}?` : 'Loading…'}</h1>
          <p className="m-0 mt-1 text-sec">
            {me.data
              ? `Signed in as ${me.data.name}. Access is limited by your role (${me.data.role}).`
              : 'Checking your session…'}
          </p>
        </div>
        <div className="card mt-8 overflow-hidden">
          <div className="px-4 pb-2 pt-4 text-[12px] font-medium text-sec">
            {name ?? 'The application'} will be able to
          </div>
          {scopes.map((s) => (
            <div key={s} className="border-t border-hair px-4 py-2">
              {SCOPE_TEXT[s] ?? s}
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-3" role="alert">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn-secondary h-10 flex-1"
            disabled={busy}
            onClick={() => void decide(false)}
          >
            Deny
          </button>
          <button
            type="button"
            className="btn-primary h-10 flex-1"
            disabled={busy}
            onClick={() => void decide(true)}
          >
            Allow
          </button>
        </div>
        {client.data?.client_uri && (
          <p className="mt-4 text-center text-[12px] text-sec">{client.data.client_uri}</p>
        )}
      </div>
    </div>
  );
}
