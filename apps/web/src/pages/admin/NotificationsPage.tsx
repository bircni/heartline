import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Empty, ErrorNote, PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { api, useMe, useNotifiers } from '../../lib/api.ts';
import { relative } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

const TYPE_LABEL = { teams: 'Microsoft Teams', email: 'E-mail', webhook: 'Webhook' } as const;

export function NotificationsPage() {
  const notifiers = useNotifiers();
  const me = useMe();
  const qc = useQueryClient();
  const [results, setResults] = useState<Record<string, { ok: boolean; error: string | null }>>({});
  const test = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean; error: string | null }>(`/api/v1/admin/notifiers/${encodeURIComponent(id)}/test`, {
        method: 'POST',
      }),
    onSuccess: async (r, id) => {
      setResults((prev) => ({ ...prev, [id]: r }));
      await qc.invalidateQueries({ queryKey: ['admin', 'notifiers'] });
    },
  });
  if (notifiers.isPending) return <Spinner />;
  if (notifiers.error) return <ErrorNote error={notifiers.error} />;
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Channels are defined in status.yaml; secrets come from environment variables or Kubernetes secrets."
      />
      {notifiers.data.length === 0 && (
        <Section className="mt-4">
          <Empty>
            No channels configured. Add `notifiers` to status.yaml (Teams workflow webhook, SMTP e-mail or a
            generic webhook).
          </Empty>
        </Section>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        {notifiers.data.map((n) => {
          const r = results[n.id];
          const failing = r ? !r.ok : Boolean(n.lastError);
          return (
            <section key={n.id} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[16px] font-medium">
                  {TYPE_LABEL[n.type]} <span className="font-normal text-sec">· {n.id}</span>
                </h2>
                <span className="flex items-center gap-2 text-[12px] text-sec">
                  <span
                    aria-hidden="true"
                    className="block h-2 w-2 rounded-full"
                    style={{ background: failing ? 'var(--bad)' : 'var(--ok)' }}
                  />
                  {failing ? 'Failing' : 'Ready'}
                </span>
              </div>
              <div className="mt-2 font-mono text-[12px] text-sec">{n.target}</div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span
                  className="min-w-0 truncate text-[12px]"
                  style={{
                    color: r
                      ? r.ok
                        ? 'var(--ok-text)'
                        : 'var(--bad-text)'
                      : n.lastError
                        ? 'var(--bad-text)'
                        : 'var(--sec)',
                  }}
                >
                  {r
                    ? r.ok
                      ? 'Test delivered just now'
                      : r.error
                    : n.lastError
                      ? `Last attempt failed: ${n.lastError}`
                      : `Last sent ${relative(n.lastSentAt)}`}
                </span>
                {can(me.data?.role, 'admin') && (
                  <button
                    type="button"
                    className="btn"
                    disabled={test.isPending && test.variables === n.id}
                    onClick={() => test.mutate(n.id)}
                  >
                    Send test
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
