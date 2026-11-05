import type { Maintenance } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Empty, ErrorNote, Field, Notice, PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { api, useMaintenance, useMe } from '../../lib/api.ts';
import { dateTime } from '../../lib/format.ts';
import { can } from './AdminLayout.tsx';
import { ServicePicker } from './IncidentsPage.tsx';

const PRESETS: { label: string; value: string }[] = [
  { label: 'Once', value: '' },
  { label: 'Daily', value: 'FREQ=DAILY' },
  { label: 'Weekly', value: 'FREQ=WEEKLY' },
  { label: 'Monthly', value: 'FREQ=MONTHLY' },
];

const pad = (n: number) => String(n).padStart(2, '0');

function localInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Create() {
  const qc = useQueryClient();
  const [start] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setMinutes(0, 0, 0);
    return d;
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(localInput(start));
  const [endsAt, setEndsAt] = useState(localInput(new Date(start.getTime() + 30 * 60_000)));
  const [recurrence, setRecurrence] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api<Maintenance>('/api/v1/admin/maintenance', {
        method: 'POST',
        json: {
          title,
          description: description || undefined,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          recurrence: recurrence || undefined,
          services,
        },
      }),
    onSuccess: async () => {
      setTitle('');
      setDescription('');
      await qc.invalidateQueries({ queryKey: ['maintenance'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="m-0 text-[16px] font-medium">Schedule maintenance</h2>
      <Field label="Title" htmlFor="mt-title">
        <input
          id="mt-title"
          className="field"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Postgres 17.2 upgrade"
        />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Starts" htmlFor="mt-start">
          <input
            id="mt-start"
            type="datetime-local"
            className="field"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Ends" htmlFor="mt-end">
          <input
            id="mt-end"
            type="datetime-local"
            className="field"
            required
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Repeats" htmlFor="mt-rec" hint="Any RFC 5545 rule works, e.g. FREQ=WEEKLY;BYDAY=SU">
        <div className="flex gap-2">
          <select
            id="mt-rec"
            className="field w-36"
            value={PRESETS.some((p) => p.value === recurrence) ? recurrence : 'custom'}
            onChange={(e) =>
              setRecurrence(e.target.value === 'custom' ? 'FREQ=WEEKLY;BYDAY=SU' : e.target.value)
            }
          >
            {PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {recurrence && (
            <input
              aria-label="Recurrence rule"
              className="field font-mono text-[12px]"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            />
          )}
        </div>
      </Field>
      <div className="mt-3">
        <div className="label">Affected services (none = all)</div>
        <ServicePicker value={services} onChange={setServices} />
      </div>
      <Field label="Description (public)" htmlFor="mt-desc">
        <textarea
          id="mt-desc"
          rows={2}
          className="field h-auto resize-y py-2"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {create.error && (
        <div className="mt-3">
          <Notice tone="bad">{create.error.message}</Notice>
        </div>
      )}
      <button type="submit" className="btn-primary mt-4 w-full" disabled={create.isPending}>
        Schedule
      </button>
    </form>
  );
}

export function MaintenancePage() {
  const list = useMaintenance();
  const me = useMe();
  const qc = useQueryClient();
  const canWrite = can(me.data?.role, 'editor');
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/admin/maintenance/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['maintenance'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  if (list.isPending) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;
  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Checks keep running, but services show as in maintenance and no alerts are sent."
      />
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          {list.data.length === 0 && <Empty>No maintenance scheduled</Empty>}
          {list.data.map((m, i) => {
            const start = new Date(m.nextStartsAt ?? m.startsAt);
            return (
              <div
                key={m.id}
                className={`flex items-center gap-4 px-4 py-3 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="w-12 shrink-0 rounded-[8px] bg-fill py-2 text-center">
                  <span className="block text-[12px] text-muted">
                    {start.toLocaleString(undefined, { month: 'short' })}
                  </span>
                  <span className="block text-[20px] font-medium leading-6">{start.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.title}
                    {m.active && (
                      <span className="ml-2 rounded-[4px] bg-fill px-2 py-0.5 text-[12px] text-sec">
                        in progress
                      </span>
                    )}
                  </span>
                  <span className="block text-[12px] text-sec">
                    {m.nextStartsAt
                      ? `${dateTime(m.nextStartsAt)} – ${dateTime(m.nextEndsAt ?? m.endsAt)}`
                      : 'finished'}
                    {m.recurrence && ` · repeats ${m.recurrence}`} ·{' '}
                    {m.services.map((s) => s.name).join(', ') || 'all services'}
                  </span>
                </span>
                {canWrite && (
                  <button
                    type="button"
                    className="btn-danger"
                    aria-label={`Delete ${m.title}`}
                    onClick={() => remove.mutate(m.id)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </Section>
        {canWrite && (
          <Section className="min-w-0 flex-[1_1_320px]">
            <Create />
          </Section>
        )}
      </div>
    </>
  );
}
