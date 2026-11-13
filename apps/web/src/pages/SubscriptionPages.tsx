import type { SubscriberEvent, SubscriptionDto } from '@heartline/shared';
import { Link, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '../components/Dialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { EVENT_LABEL, ServiceChoice, SubscribeForm } from '../components/SubscribeForm.tsx';
import { toast } from '../components/Toast.tsx';
import { ErrorNote, Notice, PageHeader, Section, Spinner } from '../components/ui.tsx';
import { api, useIncident } from '../lib/api.ts';

/** `/subscribe` (optionally `?incident=<id>`): sign up for e-mails and see the feeds. */
export function SubscribePage() {
  const { incident: incidentId } = useSearch({ strict: false }) as { incident?: string };
  const incident = useIncident(incidentId ?? '');
  return (
    <div className="flex max-w-[36rem] flex-col gap-4">
      <PageHeader title="Get notified" subtitle="Hear about incidents and maintenance by e-mail or feed." />
      <Section className="p-4">
        <SubscribeForm
          incident={
            incidentId && incident.data ? { id: incident.data.id, title: incident.data.title } : undefined
          }
        />
      </Section>
      <Section title="Feeds">
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <a href="/api/v1/incidents.atom" className="flex items-center gap-2 text-text">
            <Icon name="rss" size={14} /> Atom feed
          </a>
          <a href="/api/v1/incidents.rss" className="flex items-center gap-2 text-text">
            <Icon name="rss" size={14} /> RSS feed
          </a>
        </div>
      </Section>
    </div>
  );
}

const tokenFromUrl = () => new URLSearchParams(window.location.search).get('t') ?? '';

/** `/subscriptions/confirm?t=`: confirms with a click, so mail scanners that open links confirm nothing. */
export function ConfirmPage() {
  const [token] = useState(tokenFromUrl);
  const confirm = useMutation({
    mutationFn: () =>
      api<{ manageToken: string }>('/api/v1/subscribers/confirm', { method: 'POST', json: { token } }),
  });
  return (
    <div className="mx-auto mt-6 flex w-full max-w-[30rem] flex-col gap-4">
      <PageHeader title="Confirm your subscription" />
      <Section className="p-4">
        {confirm.isSuccess ? (
          <div role="status">
            <div className="flex items-center gap-2 font-medium">
              <Icon name="check" size={18} className="text-ok" /> You are subscribed.
            </div>
            <Link to="/subscriptions/manage" search={{ t: confirm.data.manageToken }} className="btn mt-4">
              Choose what you hear about
            </Link>
          </div>
        ) : (
          <>
            <p className="m-0 text-sec">Confirm that you want status e-mails at this address.</p>
            {confirm.error && (
              <div className="mt-3">
                <ErrorNote error={confirm.error} />
              </div>
            )}
            <button
              type="button"
              className="btn-primary mt-4 w-full"
              disabled={!token || confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? 'Confirming…' : 'Confirm subscription'}
            </button>
          </>
        )}
      </Section>
    </div>
  );
}

/** `/subscriptions/manage?t=`: change events and services, stop following incidents, or unsubscribe. */
export function ManagePage() {
  const { t, unsubscribe } = useSearch({ strict: false }) as { t?: string; unsubscribe?: string };
  const token = t ?? '';
  const headers = { 'x-subscriber-token': token };
  const confirm = useConfirm();
  const me = useQuery({
    queryKey: ['subscription', token],
    queryFn: () => api<SubscriptionDto>('/api/v1/subscribers/me', { headers }),
    enabled: Boolean(token),
    refetchInterval: false,
    retry: false,
  });
  const [events, setEvents] = useState<SubscriberEvent[] | null>(null);
  const [components, setComponents] = useState<'all' | string[] | null>(null);
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: (incidents?: string[]) =>
      api<SubscriptionDto>('/api/v1/subscribers/me', {
        method: 'PATCH',
        headers,
        json: { events: events ?? undefined, components: components ?? undefined, incidents },
      }),
    onSuccess: async () => {
      await me.refetch();
      toast('Saved');
    },
  });
  const leave = useMutation({
    mutationFn: () => api('/api/v1/subscribers/me', { method: 'DELETE', headers }),
    onSuccess: () => setDone(true),
  });
  // The "Unsubscribe" link in e-mails opens this page and asks right away.
  const asked = useRef(false);
  useEffect(() => {
    if (unsubscribe && me.data?.status === 'active' && !asked.current) {
      asked.current = true;
      void confirm({
        title: 'Unsubscribe?',
        message: `No more status e-mails to ${me.data.email}.`,
        confirm: 'Unsubscribe',
      }).then((ok) => ok && leave.mutate());
    }
  }, [unsubscribe, me.data, confirm, leave]);
  if (!token) return <ErrorNote error={new Error('This link is incomplete.')} />;
  if (me.isPending) return <Spinner />;
  if (done || me.data?.status === 'unsubscribed')
    return (
      <div className="mx-auto mt-6 w-full max-w-[30rem]">
        <Notice>You are unsubscribed. You will get no more e-mails from this status page.</Notice>
        <Link to="/subscribe" className="btn mt-4">
          Subscribe again
        </Link>
      </div>
    );
  if (me.error) return <ErrorNote error={me.error} />;
  const s = me.data;
  const chosenEvents = events ?? s.events;
  return (
    <div className="flex max-w-[36rem] flex-col gap-4">
      <PageHeader title="Your subscription" subtitle={s.email} />
      <Section className="p-4">
        <fieldset className="m-0 border-0 p-0">
          <legend className="label">Tell me about</legend>
          {s.available.events.map((e) => (
            <label key={e} className="mt-1 flex items-start gap-2 text-base">
              <input
                type="checkbox"
                className="mt-1"
                checked={chosenEvents.includes(e)}
                onChange={(ev) =>
                  setEvents(ev.target.checked ? [...chosenEvents, e] : chosenEvents.filter((x) => x !== e))
                }
              />
              <span>
                {EVENT_LABEL[e].label}
                <span className="block text-xs text-sec">{EVENT_LABEL[e].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <ServiceChoice
          value={components ?? s.components}
          onChange={setComponents}
          services={s.available.services}
        />
        {save.error && (
          <div className="mt-3">
            <ErrorNote error={save.error} />
          </div>
        )}
        <button
          type="button"
          className="btn-primary mt-4"
          disabled={save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </Section>
      {s.incidents.length > 0 && (
        <Section title="Incidents you follow">
          {s.incidents.map((i) => (
            <div
              key={i.id}
              className="flex items-center gap-3 border-t border-hair px-3.5 py-2 first:border-t-0"
            >
              <Link to="/incidents/$id" params={{ id: i.id }} className="min-w-0 flex-1 truncate text-text">
                {i.title}
              </Link>
              <button
                type="button"
                className="btn-sm"
                onClick={() => save.mutate(s.incidents.filter((x) => x.id !== i.id).map((x) => x.id))}
              >
                Stop following
              </button>
            </div>
          ))}
        </Section>
      )}
      <button
        type="button"
        className="btn-danger self-start"
        disabled={leave.isPending}
        onClick={async () => {
          if (
            await confirm({
              title: 'Unsubscribe?',
              message: `No more status e-mails to ${s.email}.`,
              confirm: 'Unsubscribe',
            })
          )
            leave.mutate();
        }}
      >
        Unsubscribe
      </button>
    </div>
  );
}
