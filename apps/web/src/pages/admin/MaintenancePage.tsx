import type { Maintenance, MaintenanceStatus } from '@heartline/shared';
import { MAINTENANCE_STATUSES } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { MarkdownField } from '../../components/MarkdownField.tsx';
import { Segmented } from '../../components/Segmented.tsx';
import { Switch } from '../../components/Switch.tsx';
import { UpdateTimeline } from '../../components/UpdateTimeline.tsx';
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
import { api, useMaintenance, useMe, useTemplates } from '../../lib/api.ts';
import {
  MAINTENANCE_LABEL,
  dateTime,
  displayDay,
  fromZonedInput,
  toZonedInput,
  zoneShort,
} from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';
import { ServicePicker } from './IncidentsPage.tsx';

const monthShort = (day: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(
    Date.parse(`${day}T00:00:00Z`),
  );

const PRESETS: { label: string; value: string }[] = [
  { label: 'Once', value: '' },
  { label: 'Daily', value: 'FREQ=DAILY' },
  { label: 'Weekly', value: 'FREQ=WEEKLY' },
  { label: 'Monthly', value: 'FREQ=MONTHLY' },
];

function Editor({ existing, onDone }: { existing: Maintenance | null; onDone: () => void }) {
  const qc = useQueryClient();
  // Tomorrow at this hour by default; times are entered in the site's time zone, like they are shown.
  const [start] = useState(() => Math.floor((Date.now() + 86_400_000) / 3_600_000) * 3_600_000);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [startsAt, setStartsAt] = useState(toZonedInput(existing ? existing.startsAt : start));
  const [endsAt, setEndsAt] = useState(toZonedInput(existing ? existing.endsAt : start + 30 * 60_000));
  const [recurrence, setRecurrence] = useState(existing?.recurrence ?? '');
  const [services, setServices] = useState<string[]>(existing?.services.map((s) => s.id) ?? []);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const templates = useTemplates('maintenance');
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        description: description || (existing ? null : undefined),
        startsAt: new Date(fromZonedInput(startsAt)).toISOString(),
        endsAt: new Date(fromZonedInput(endsAt)).toISOString(),
        recurrence: recurrence || (existing ? null : undefined),
        services,
        ...(existing ? {} : { notify }),
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
        if (fromZonedInput(endsAt) <= fromZonedInput(startsAt)) {
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
        {!existing && (templates.data?.length ?? 0) > 0 && (
          <select
            aria-label="Start from a template"
            className="field h-7 w-auto py-0 text-xs"
            value=""
            onChange={(e) => {
              const t = templates.data?.find((x) => x.id === e.target.value);
              if (!t) return;
              setTitle(t.title);
              setDescription(t.body);
              setServices(t.services.map((s) => s.id));
              if (t.durationMs) setEndsAt(toZonedInput(fromZonedInput(startsAt) + t.durationMs));
            }}
          >
            <option value="">From a template…</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
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
          <Field label={`Starts (${zoneShort(fromZonedInput(startsAt) || start)})`} htmlFor="mt-start">
            <input
              id="mt-start"
              type="datetime-local"
              className="field"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field label={`Ends (${zoneShort(fromZonedInput(endsAt) || start)})`} htmlFor="mt-end">
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
          <MarkdownField id="mt-desc" rows={3} value={description} onChange={setDescription} />
        </Field>
      </FieldErrors>
      {!existing && (
        <span className="mt-3 flex items-center gap-2 text-base text-sec">
          <Switch checked={notify} onChange={setNotify} label="Announce now" /> Announce now (reminder and
          start follow)
        </span>
      )}
      {saveErrors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{saveErrors.rest.join(' · ')}</Notice>
        </div>
      )}
      <button type="submit" className="btn-primary mt-4 w-full" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Schedule'}
      </button>
      {existing && <Updates window={existing} />}
    </form>
  );
}

/** Status updates of a one-off window; recurring windows move along by themselves. */
function Updates({ window: m }: { window: Maintenance }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<MaintenanceStatus>(
    m.status === 'scheduled' ? 'in_progress' : m.status === 'in_progress' ? 'verifying' : 'completed',
  );
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState(true);
  const post = useMutation({
    mutationFn: () =>
      api<Maintenance>(`/api/v1/admin/maintenance/${m.id}/updates`, {
        method: 'POST',
        json: { status, message, notify },
      }),
    onSuccess: async () => {
      setMessage('');
      await qc.invalidateQueries({ queryKey: ['maintenance'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      toast('Update posted');
    },
  });
  return (
    <div className="mt-5 border-t border-hair pt-4">
      <h3 className="m-0 text-base font-semibold">Status: {MAINTENANCE_LABEL[m.status]}</h3>
      {m.recurrence ? (
        <p className="m-0 mt-1 text-sec">Recurring windows start and complete on their own.</p>
      ) : m.status === 'completed' ? (
        <p className="m-0 mt-1 text-sec">Completed. Move it to a future time to schedule it again.</p>
      ) : (
        // A nested form would be invalid HTML; the button submits through its own handler.
        <div className="mt-2 rounded-xl bg-fill p-3">
          <div className="rounded-md bg-bg p-0.5">
            <Segmented
              size="sm"
              label="New status"
              value={status}
              onChange={setStatus}
              options={MAINTENANCE_STATUSES.map((st) => ({ value: st, label: MAINTENANCE_LABEL[st] }))}
            />
          </div>
          <MarkdownField
            id="mt-update"
            label="Update message"
            className="mt-2"
            rows={2}
            value={message}
            onChange={setMessage}
            placeholder="What is happening? Shown publicly."
          />
          {post.error && (
            <p role="alert" className="m-0 mt-2 text-base text-bad-text">
              {post.error.message}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base text-sec">
              <Switch checked={notify} onChange={setNotify} label="Notify channels" /> Notify channels
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={post.isPending || !message.trim()}
              onClick={() => post.mutate()}
            >
              {post.isPending ? 'Posting…' : 'Post update'}
            </button>
          </div>
        </div>
      )}
      {m.updates.length > 0 && (
        <div className="mt-3">
          <UpdateTimeline
            updates={m.updates.map((u) => ({ ...u, status: MAINTENANCE_LABEL[u.status] as never }))}
            accent="var(--maint)"
          />
        </div>
      )}
    </div>
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
            const start = m.nextStartsAt ?? m.startsAt;
            const day = displayDay(start);
            return (
              <div
                key={m.id}
                className={`flex items-center gap-4 px-4 py-3 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="w-12 shrink-0 rounded-md bg-fill py-2 text-center">
                  <span className="block text-xs text-muted">{monthShort(day)}</span>
                  <span className="block text-2xl font-medium leading-6">{Number(day.slice(8))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.title}
                    {m.status !== 'scheduled' && (
                      <span
                        className={`ml-2 rounded-sm px-2 py-0.5 text-xs ${m.active ? 'bg-maint-bg font-medium text-maint' : 'bg-fill text-sec'}`}
                      >
                        {MAINTENANCE_LABEL[m.status].toLowerCase()}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-sec">
                    {m.status === 'completed' || !m.nextStartsAt
                      ? `${dateTime(m.startsAt)} – ${dateTime(m.endsAt)}`
                      : `${dateTime(m.nextStartsAt)} – ${dateTime(m.nextEndsAt ?? m.endsAt)}`}
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
