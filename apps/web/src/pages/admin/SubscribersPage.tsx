import type { SubscriberDto } from '@heartline/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '../../components/Dialog.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EVENT_LABEL } from '../../components/SubscribeForm.tsx';
import { toast } from '../../components/Toast.tsx';
import { EmptyState, ErrorNote, Notice, PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { api, useBootstrap } from '../../lib/api.ts';
import { dateTime, relative } from '../../lib/format.ts';

export function SubscribersPage() {
  const boot = useBootstrap();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({
    queryKey: ['admin', 'subscribers'],
    queryFn: () => api<SubscriberDto[]>('/api/v1/admin/subscribers'),
  });
  const remove = useMutation({
    mutationFn: (s: SubscriberDto) => api(`/api/v1/admin/subscribers/${s.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, s) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'subscribers'] });
      toast(`Removed ${s.email}`);
    },
    meta: { errorToast: true },
  });
  if (list.isPending) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;
  const active = list.data.filter((s) => s.status === 'active').length;
  return (
    <>
      <PageHeader title="Subscribers" subtitle={`${active} active · people who get status e-mails`} />
      {!boot.data?.subscribe.email && (
        <Notice tone="warn">
          E-mail sign-up is off: add an <span className="font-mono text-xs">email</span> notifier in
          status.yaml (or name one in <span className="font-mono text-xs">subscribers.email.notifier</span>).
        </Notice>
      )}
      <Section>
        {list.data.length === 0 && (
          <EmptyState title="No subscribers yet">Visitors sign up from the Subscribe button.</EmptyState>
        )}
        {list.data.map((s, i) => (
          <div
            key={s.id}
            className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 ${i ? 'border-t border-hair' : ''}`}
          >
            <span className="min-w-0 flex-[1_1_16rem]">
              <span className="block truncate font-medium">{s.email}</span>
              <span className="block text-xs text-sec">
                {s.status === 'active' ? `since ${dateTime(s.confirmedAt ?? s.createdAt)}` : s.status} ·{' '}
                {s.events.map((e) => EVENT_LABEL[e].label.toLowerCase()).join(', ')} ·{' '}
                {s.components === 'all' ? 'all services' : `${s.components.length} services`}
                {s.incidents > 0 && ` · follows ${s.incidents} incident${s.incidents === 1 ? '' : 's'}`}
              </span>
              {s.lastError && (
                <span className="block text-xs text-bad-text">Last e-mail failed: {s.lastError}</span>
              )}
            </span>
            <span className="text-xs text-sec">last e-mail {relative(s.lastSentAt)}</span>
            <button
              type="button"
              className="icon-btn text-bad-text hover:text-bad-text"
              aria-label={`Remove ${s.email}`}
              disabled={remove.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Remove ${s.email}?`,
                    message: 'They get no more e-mails.',
                    confirm: 'Remove',
                  })
                )
                  remove.mutate(s);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </Section>
    </>
  );
}
