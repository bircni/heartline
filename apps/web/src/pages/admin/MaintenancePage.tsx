import type { Maintenance } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { useConfirm } from '../../components/Dialog.tsx';
import { toast } from '../../components/Toast.tsx';
import {
  EmptyState,
  ErrorNote,
  Field,
  FieldErrors,
  Notice,
  PageHeader,
  Section,
  Spinner,
  fieldErrorsOf,
} from '../../components/ui.tsx';
import { api, useMaintenance, useMe } from '../../lib/api.ts';
import { dateTime } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';
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

function Editor({ existing, onDone }: { existing: Maintenance | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [start] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setMinutes(0, 0, 0);
    return d;
  });
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [startsAt, setStartsAt] = useState(localInput(existing ? new Date(existing.startsAt) : start));
  const [endsAt, setEndsAt] = useState(
    localInput(existing ? new Date(existing.endsAt) : new Date(start.getTime() + 30 * 60_000)),
  );
  const [recurrence, setRecurrence] = useState(existing?.recurrence ?? '');
  const [services, setServices] = useState<string[]>(existing?.services.map((s) => s.id) ?? []);
  const [orderError, setOrderError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        description: description || (existing ? null : undefined),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        recurrence: recurrence || (existing ? null : undefined),
        services,
      };
      return existing
        ? api<Maintenance>(`/api/v1/admin/maintenance/${existing.id}`, { method: 'PUT', json: body })
        : api<Maintenance>('/api/v1/admin/maintenance', { method: 'POST', json: body });
    },
    onSuccess: async (m) => {
      toast(existing ? `Saved ${m.title}` : `Scheduled ${m.title}`);
      if (!existing) {
        setTitle('');
        setDescription('');
      }
      await qc.invalidateQueries({ queryKey: ['maintenance'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      onDone();
    },
  });
  const saveErrors = fieldErrorsOf(save.error, {
    title: 'mt-title',
    startsAt: 'mt-start',
    endsAt: 'mt-end',
    recurrence: 'mt-rec',
    description: 'mt-desc',
  });
  const errors = orderError ? { ...saveErrors.byId, 'mt-end': orderError } : saveErrors.byId;
  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (Date.parse(endsAt) <= Date.parse(startsAt)) {
          setOrderError('The window must end after it starts.');
          return;
        }
        setOrderError(null);
        save.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">
          {existing ? `Edit “${existing.title}”` : 'Schedule maintenance'}
        </h2>
        {existing && (
          <button type="button" className="btn-sm" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      <FieldErrors errors={errors}>
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
              min={startsAt}
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
                className="field font-mono text-xs"
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
      </FieldErrors>
      {saveErrors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{saveErrors.rest.join(' · ')}</Notice>
        </div>
      )}
      <button type="submit" className="btn-primary mt-4 w-full" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Schedule'}
      </button>
    </form>
  );
}

export function MaintenancePage() {
  const list = useMaintenance();
  const me = useMe();
  const qc = useQueryClient();
  const canWrite = can(me.data?.role, 'editor');
  const [editing, setEditing] = useState<string | null>(null);
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: (m: Maintenance) => api(`/api/v1/admin/maintenance/${m.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, m) => {
      if (editing === m.id) setEditing(null);
      await qc.invalidateQueries({ queryKey: ['maintenance'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      toast(`Deleted ${m.title}`);
    },
    meta: { errorToast: true },
  });
  if (list.isPending) return <Spinner />;
  if (list.error) return <ErrorNote error={list.error} />;
  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Checks keep running, but services show as in maintenance and no alerts are sent."
      />
      <div className="flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          {list.data.length === 0 && (
            <EmptyState title="No maintenance scheduled">
              During a window, services show as in maintenance and no alerts are sent.
            </EmptyState>
          )}
          {list.data.map((m, i) => {
            const start = new Date(m.nextStartsAt ?? m.startsAt);
            return (
              <div
                key={m.id}
                className={`flex items-center gap-4 px-4 py-3 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="w-12 shrink-0 rounded-md bg-fill py-2 text-center">
                  <span className="block text-xs text-muted">
                    {start.toLocaleString(undefined, { month: 'short' })}
                  </span>
                  <span className="block text-2xl font-medium leading-6">{start.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.title}
                    {m.active && (
                      <span className="ml-2 rounded-sm bg-fill px-2 py-0.5 text-xs text-sec">
                        in progress
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-sec">
                    {m.nextStartsAt
                      ? `${dateTime(m.nextStartsAt)} – ${dateTime(m.nextEndsAt ?? m.endsAt)}`
                      : 'finished'}
                    {m.recurrence && ` · repeats ${m.recurrence}`} ·{' '}
                    {m.services.map((s) => s.name).join(', ') || 'all services'}
                  </span>
                </span>
                {canWrite && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Edit ${m.title}`}
                      onClick={() => setEditing(m.id)}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn text-bad-text hover:text-bad-text"
                      aria-label={`Delete ${m.title}`}
                      disabled={remove.isPending}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete “${m.title}”?`,
                            message: m.recurrence ? 'Every future occurrence is removed as well.' : undefined,
                            confirm: 'Delete',
                          })
                        )
                          remove.mutate(m);
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </Section>
        {canWrite && (
          <Section className="min-w-0 flex-[1_1_320px]">
            <Editor
              key={editing ?? '__new'}
              existing={list.data.find((m) => m.id === editing) ?? null}
              onDone={() => setEditing(null)}
            />
          </Section>
        )}
      </div>
    </>
  );
}
