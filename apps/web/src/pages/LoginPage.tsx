import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { Icon, Logo } from '../components/Icon.tsx';
import { Notice } from '../components/ui.tsx';
import { useBootstrap, useMe } from '../lib/api.ts';
import { authClient, authorizeUrlFrom, isOAuthContinuation } from '../lib/auth.ts';
import { ThemeButton } from './PublicLayout.tsx';

export function LoginPage() {
  const boot = useBootstrap();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const oauth = isOAuthContinuation(search);
  const errorParam = new URLSearchParams(search).get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    errorParam ? decodeURIComponent(errorParam).replace(/_/g, ' ') : null,
  );
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. back from Gitea): resume the MCP authorization or go to the admin area.
  useEffect(() => {
    if (!me.data) return;
    if (oauth) window.location.assign(authorizeUrlFrom(search));
    else void navigate({ to: '/admin' });
  }, [me.data, oauth, search, navigate]);

  const finish = async (data: unknown) => {
    const url = (data as { url?: string; redirect?: boolean } | null)?.url;
    if (oauth && url) {
      window.location.assign(url);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['me'] });
    void navigate({ to: '/admin' });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) setError(res.error.message ?? 'Sign-in failed');
    else await finish(res.data);
  };

  const social = async (provider: string) => {
    setBusy(true);
    const callbackURL = oauth ? `/login${search}` : '/admin';
    const res = await authClient.signIn.social({
      provider,
      callbackURL,
      errorCallbackURL: `/login${oauth ? search : ''}`,
    });
    if (res.error) {
      setBusy(false);
      setError(res.error.message ?? 'Sign-in failed');
    }
  };

  const site = boot.data?.site;
  const providers = boot.data?.auth.oidc ?? [];
  const local = boot.data?.auth.local ?? true;

  return (
    <div className="flex min-h-screen justify-center px-4 pb-20 pt-[12vh]">
      <div className="absolute right-4 top-4">
        <ThemeButton />
      </div>
      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="m-0 mt-4 text-[20px] font-medium">
            {oauth ? 'Sign in to connect' : `Sign in to ${site?.title ?? 'Status'}`}
          </h1>
          <p className="m-0 mt-1 text-sec">
            {oauth
              ? 'An application wants to access this status page'
              : (site?.description ?? window.location.host)}
          </p>
        </div>
        <div className="card mt-8 p-5">
          {error && (
            <div className="mb-4" role="alert">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}
          {providers.map((p, i) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => void social(p.id)}
              className={`flex h-10 w-full items-center justify-center gap-2 rounded-[8px] text-[14px] font-medium disabled:opacity-50 ${i === 0 ? 'bg-text text-bg' : 'mt-2 bg-fill text-text'}`}
            >
              <Icon name="gitea" size={16} />
              Continue with {p.name}
            </button>
          ))}
          {providers.length > 0 && local && (
            <div aria-hidden="true" className="my-4 flex items-center gap-2 text-[12px] text-sec">
              <span className="h-px flex-1 bg-hair" />
              or
              <span className="h-px flex-1 bg-hair" />
            </div>
          )}
          {local && (
            <form onSubmit={(e) => void onSubmit(e)}>
              <label htmlFor="email" className="label">
                E-mail
              </label>
              <input
                id="email"
                className="field"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="password" className="label mt-3">
                Password
              </label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={busy}
                className={`mt-4 h-10 w-full rounded-[8px] text-[14px] font-medium disabled:opacity-50 ${providers.length ? 'bg-fill text-text' : 'bg-text text-bg'}`}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
          {!local && providers.length === 0 && (
            <Notice>No sign-in method is configured in status.yaml</Notice>
          )}
        </div>
        <p className="mt-4 text-center text-[12px] text-sec">Accounts are managed by your administrator</p>
      </div>
    </div>
  );
}
