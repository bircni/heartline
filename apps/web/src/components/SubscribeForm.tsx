import type { SubscriberEvent } from '@heartline/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api, useBootstrap, useNavOverview } from '../lib/api.ts';
import { Icon } from './Icon.tsx';
import { Field, FieldErrors, Notice, fieldErrorsOf } from './ui.tsx';

export const EVENT_LABEL: Record<SubscriberEvent, { label: string; hint: string }> = {
  incidents: { label: 'Incidents', hint: 'New incidents, their updates and postmortems' },
  automaticIncidents: { label: 'Automatic incidents', hint: 'Outages detected by the checks themselves' },
  maintenance: { label: 'Maintenance', hint: 'Scheduled, starting soon, started and completed' },
  componentStatus: { label: 'Every status change', hint: 'Whenever a service changes status' },
};

/** Service picker by group: all services, or the chosen ones. */
export function ServiceChoice({
  value,
  onChange,
  services,
}: {
  value: 'all' | string[];
  onChange: (v: 'all' | string[]) => void;
  services: { id: string; name: string; group: string }[];
}) {
  const groups = [...new Set(services.map((s) => s.group))];
  return (
    <fieldset className="m-0 mt-3 border-0 p-0">
      <legend className="label">Services</legend>
      <label className="flex items-center gap-2 text-base">
        <input type="radio" checked={value === 'all'} onChange={() => onChange('all')} /> All services
      </label>
      <label className="mt-1 flex items-center gap-2 text-base">
        <input type="radio" checked={value !== 'all'} onChange={() => onChange([])} /> Only these:
      </label>
      {value !== 'all' && (
        <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md bg-fill p-3">
          {groups.map((g) => (
            <div key={g}>
              <div className="text-xs font-medium text-sec">{g}</div>
              {services
                .filter((s) => s.group === g)
                .map((s) => (
                  <label key={s.id} className="mt-1 flex items-center gap-2 text-base">
                    <input
                      type="checkbox"
                      checked={value.includes(s.id)}
                      onChange={(e) =>
                        onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))
                      }
                    />
                    {s.name}
                  </label>
                ))}
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** E-mail sign-up: address, what to hear about, which services. Ends with "check your inbox". */
export function SubscribeForm({ incident }: { incident?: { id: string; title: string } }) {
  const boot = useBootstrap();
  const overview = useNavOverview();
  const offered = boot.data?.subscribe.events ?? [];
  const [email, setEmail] = useState('');
  const [events, setEvents] = useState<SubscriberEvent[] | null>(null);
  const [components, setComponents] = useState<'all' | string[]>('all');
  const chosen = events ?? offered;
  const services = [...(overview.data?.groups ?? []), ...(overview.data?.external ?? [])].flatMap((g) =>
    g.services.map((s) => ({ id: s.id, name: s.name, group: g.name })),
  );
  const submit = useMutation({
    mutationFn: () =>
      api('/api/v1/subscribers', {
        method: 'POST',
        json: { email, events: chosen, components, incidentId: incident?.id },
      }),
  });
  const errors = fieldErrorsOf(submit.error, { email: 'sub-email' });
  if (!boot.data?.subscribe.email)
    return <Notice>E-mail notifications are not set up for this status page. Use the feed instead.</Notice>;
  if (submit.isSuccess)
    return (
      <div role="status" className="flex items-start gap-3">
        <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ok" />
        <div>
          <div className="font-medium">Check your inbox</div>
          <p className="m-0 mt-0.5 text-sec">
            We sent a link to {email}. Your subscription starts when you open it. If the address is already
            subscribed, you get a link to manage it instead.
          </p>
        </div>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      {incident && (
        <p className="m-0 text-sec">
          Get every update on <span className="font-medium text-text">{incident.title}</span>, plus what you
          choose below.
        </p>
      )}
      <FieldErrors errors={errors.byId}>
        <Field label="E-mail address" htmlFor="sub-email">
          <input
            id="sub-email"
            type="email"
            required
            autoComplete="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
      </FieldErrors>
      {offered.length > 1 && (
        <fieldset className="m-0 mt-3 border-0 p-0">
          <legend className="label">Tell me about</legend>
          {offered.map((e) => (
            <label key={e} className="mt-1 flex items-start gap-2 text-base">
              <input
                type="checkbox"
                className="mt-1"
                checked={chosen.includes(e)}
                onChange={(ev) =>
                  setEvents(ev.target.checked ? [...chosen, e] : chosen.filter((x) => x !== e))
                }
              />
              <span>
                {EVENT_LABEL[e].label}
                <span className="block text-xs text-sec">{EVENT_LABEL[e].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <ServiceChoice value={components} onChange={setComponents} services={services} />
      {errors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{errors.rest.join(' · ')}</Notice>
        </div>
      )}
      <button
        type="submit"
        className="btn-primary mt-4 w-full"
        disabled={submit.isPending || chosen.length === 0}
      >
        {submit.isPending ? 'Subscribing…' : 'Subscribe'}
      </button>
      <p className="m-0 mt-2 text-xs text-muted">
        Every e-mail has a link to change your choices or unsubscribe.
      </p>
    </form>
  );
}
