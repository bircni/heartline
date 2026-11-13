import type { ApiTokenDto, Scope } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Empty, ErrorNote, Field, Notice, PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { api, useMe, useTokens } from '../../lib/api.ts';
import { dateTime, relative } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

const SCOPES: { value: Scope; min: 'viewer' | 'editor' | 'admin' }[] = [
  { value: 'read', min: 'viewer' },
  { value: 'write', min: 'editor' },
  { value: 'admin', min: 'admin' },
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-sm shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={16} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function TokensPage() {
  const me = useMe();
  const isAdmin = can(me.data?.role, 'admin');
  const [all, setAll] = useState(false);
  const tokens = useTokens(all && isAdmin);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['read']);
  const [expires, setExpires] = useState<number | null>(90);
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'tokens'] });
  const create = useMutation({
    mutationFn: () =>
      api<ApiTokenDto & { token: string }>('/api/v1/admin/tokens', {
        method: 'POST',
        json: { name, scopes, expiresInDays: expires },
      }),
    onSuccess: async (t) => {
      setCreated(t.token);
      setName('');
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/admin/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const mcpUrl = `${window.location.origin}/mcp`;
  const command = `claude mcp add --transport http status ${mcpUrl}`;

  return (
    <>
      <PageHeader
        title="API tokens"
        subtitle="For scripts, dashboards and headless MCP clients."
        actions={
          isAdmin && (
            <label className="flex items-center gap-2 text-base text-sec">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show
              everyone’s tokens
            </label>
          )
        }
      />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-[999_1_420px]">
          <Section>
            {tokens.isPending && <Spinner />}
            {tokens.error && <ErrorNote error={tokens.error} />}
            {tokens.data?.length === 0 && <Empty>No tokens yet</Empty>}
            {tokens.data?.map((t, i) => (
              <div
                key={t.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="min-w-0 flex-[1_1_200px]">
                  <span className="block font-medium">{t.name}</span>
                  <span className="block font-mono text-xs text-muted">
                    {t.prefix}
                    {all && ` · ${t.owner}`}
                  </span>
                </span>
                <span className="text-xs text-sec">{t.scopes.join(', ')}</span>
                <span className="text-xs text-sec">
                  used {relative(t.lastUsedAt)} ·{' '}
                  {t.expiresAt ? `expires ${dateTime(t.expiresAt)}` : 'never expires'}
                </span>
                <button
                  type="button"
                  className="btn-sm text-bad-text"
                  onClick={() => {
                    if (
                      window.confirm(`Revoke token “${t.name}”? Clients using it stop working immediately.`)
                    )
                      revoke.mutate(t.id);
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </Section>
          <Section className="mt-3 p-4">
            <h2 className="m-0 text-lg font-medium">Connect an MCP client</h2>
            <p className="m-0 mt-1 text-sec">
              Clients sign in through this page with OAuth (Gitea or a local account). No token needed.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-md bg-fill px-3 py-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
                {command}
              </code>
              <CopyButton text={command} />
            </div>
            <p className="m-0 mt-3 text-xs text-sec">
              Headless clients can send a token instead:{' '}
              <span className="font-mono">Authorization: Bearer hl_…</span>
            </p>
          </Section>
        </div>
        <Section className="min-w-0 flex-[1_1_300px] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <h2 className="m-0 text-lg font-medium">New token</h2>
            <Field label="Name" htmlFor="t-name">
              <input
                id="t-name"
                className="field"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="homepage-widget"
              />
            </Field>
            <div className="mt-3">
              <div className="label">Scopes</div>
              <div role="group" aria-label="Scopes" className="flex gap-2">
                {SCOPES.filter((s) => can(me.data?.role, s.min)).map((s) => {
                  const on = scopes.includes(s.value);
                  return (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setScopes(on ? scopes.filter((x) => x !== s.value) : [...scopes, s.value])
                      }
                      className={`h-8 flex-1 rounded-md text-base font-medium ${on ? 'bg-text text-bg' : 'bg-fill text-text'}`}
                    >
                      {s.value}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Expires" htmlFor="t-exp">
              <select
                id="t-exp"
                className="field"
                value={expires ?? 'never'}
                onChange={(e) => setExpires(e.target.value === 'never' ? null : Number(e.target.value))}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
                <option value="never">never</option>
              </select>
            </Field>
            {create.error && (
              <div className="mt-3">
                <Notice tone="bad">{create.error.message}</Notice>
              </div>
            )}
            <button
              type="submit"
              className="btn-primary mt-4 w-full"
              disabled={create.isPending || scopes.length === 0}
            >
              Generate token
            </button>
          </form>
          {created && (
            <div className="mt-3 rounded-md bg-fill p-3" role="status">
              <div className="text-xs font-medium text-warn-text">Copy it now. It won’t be shown again.</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{created}</code>
                <CopyButton text={created} />
              </div>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
