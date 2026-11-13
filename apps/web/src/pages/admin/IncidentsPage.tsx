import type { Impact, Incident, IncidentStatus } from '@heartline/shared';
import { IMPACTS, INCIDENT_STATUSES } from '@heartline/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Segmented } from '../../components/Segmented.tsx';
import { Switch } from '../../components/Switch.tsx';
import { useConfirm } from '../../components/Dialog.tsx';
import { toast } from '../../components/Toast.tsx';
import {
  Empty,
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
import { api, useAdminMonitors, useIncidents, useMe } from '../../lib/api.ts';
import { IMPACT_LABEL, dateTime, duration, incidentTone } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ServicePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const monitors = useAdminMonitors();
  return (
    <div className="flex flex-wrap gap-2">
      {monitors.data?.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== m.id) : [...value, m.id])}
            className={`h-7 rounded-md px-3 text-xs font-medium ${on ? 'bg-text text-bg' : 'bg-fill text-text'}`}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

function Declare({ onDone }: { onDone: (i: Incident) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [impact, setImpact] = useState<Impact>('degraded');
  const [services, setServices] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      api<Incident>('/api/v1/admin/incidents', {
        method: 'POST',
        json: { title, message, impact, services, notify },
      }),
    onSuccess: async (i) => {
      await qc.invalidateQueries({ queryKey: ['incidents'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      toast(`Declared ${i.title}`);
      onDone(i);
    },
  });
  const createErrors = fieldErrorsOf(create.error, { title: 'i-title', message: 'i-msg' });
  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="m-0 text-lg font-medium">Declare incident</h2>
      <FieldErrors errors={createErrors.byId}>
        <Field label="Title" htmlFor="i-title">
          <input
            id="i-title"
            className="field"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Slow file sync"
          />
        </Field>
        <div className="mt-3">
          <div className="label">Impact</div>
          <Segmented
            size="sm"
            label="Impact"
            value={impact}
            onChange={setImpact}
            options={IMPACTS.map((i) => ({ value: i, label: IMPACT_LABEL[i] }))}
          />
        </div>
        <div className="mt-3">
          <div className="label">Affected services</div>
          <ServicePicker value={services} onChange={setServices} />
        </div>
        <Field label="First update (public)" htmlFor="i-msg">
          <textarea
            id="i-msg"
            rows={3}
            required
            className="field h-auto resize-y py-2"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="We are investigating reports of…"
          />
        </Field>
      </FieldErrors>
      {createErrors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{createErrors.rest.join(' · ')}</Notice>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base text-sec">
          <Switch checked={notify} onChange={setNotify} label="Notify channels" /> Notify channels
        </span>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Declaring…' : 'Declare'}
        </button>
      </div>
    </form>
  );
}

function Detail({
  incident,
  canWrite,
  canDelete,
  onDeleted,
}: {
  incident: Incident;
  canWrite: boolean;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState(true);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['incidents'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const post = useMutation({
    mutationFn: () =>
      api<Incident>(`/api/v1/admin/incidents/${incident.id}/updates`, {
        method: 'POST',
        json: { status, message, notify },
      }),
    onSuccess: async () => {
      setMessage('');
      await refresh();
      toast('Update posted');
    },
  });
  const postErrors = fieldErrorsOf(post.error, { message: 'u-msg' });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/admin/incidents/${incident.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      onDeleted();
      await refresh();
      toast(`Deleted ${incident.title}`);
    },
    meta: { errorToast: true },
  });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(incident.title);
  const [impact, setImpact] = useState<Impact>(incident.impact);
  const [services, setServices] = useState<string[]>(incident.services.map((s) => s.id));
  const edit = useMutation({
    mutationFn: () =>
      api<Incident>(`/api/v1/admin/incidents/${incident.id}`, {
        method: 'PATCH',
        json: { title, impact, services },
      }),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
      toast('Saved');
    },
  });
  const editErrors = fieldErrorsOf(edit.error, { title: 'e-title' });
  const confirm = useConfirm();
  const open = incident.resolvedAt === null;
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-xs font-medium"
            style={{ color: open ? incidentTone(incident).text : 'var(--sec)' }}
          >
            {cap(incident.status)} · {IMPACT_LABEL[incident.impact]} ·{' '}
            {incident.services.map((s) => s.name).join(', ') || 'no services'}
          </div>
          <h2 className="m-0 mt-0.5 text-2xl font-medium">{incident.title}</h2>
          <div className="text-xs text-sec">
            {dateTime(incident.createdAt)} · {duration(incident.createdAt, incident.resolvedAt)}
            {incident.automatic && ' · automatic'}
          </div>
        </div>
        {canWrite && !editing && (
          <button type="button" className="btn h-7 shrink-0 px-3 text-xs" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Edit
          </button>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 rounded-xl bg-fill p-4"
          onSubmit={(e) => {
            e.preventDefault();
            edit.mutate();
          }}
        >
          <Field label="Title" htmlFor="e-title" error={editErrors.byId['e-title']}>
            <input
              id="e-title"
              className="field bg-bg"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="mt-3">
            <div className="label">Impact</div>
            <div className="rounded-md bg-bg p-0.5">
              <Segmented
                size="sm"
                label="Impact"
                value={impact}
                onChange={setImpact}
                options={IMPACTS.map((i) => ({ value: i, label: IMPACT_LABEL[i] }))}
              />
            </div>
          </div>
          <div className="mt-3">
            <div className="label">Affected services</div>
            <ServicePicker value={services} onChange={setServices} />
          </div>
          {editErrors.rest.length > 0 && (
            <p role="alert" className="m-0 mt-2 text-base text-bad-text">
              {editErrors.rest.join(' · ')}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={edit.isPending}>
              Save changes
            </button>
          </div>
        </form>
      )}
      {canWrite && (
        <form
          className="mt-4 rounded-xl bg-fill p-4"
          onSubmit={(e) => {
            e.preventDefault();
            post.mutate();
          }}
        >
          <div className="rounded-md bg-bg p-0.5">
            <Segmented
              size="sm"
              label="New status"
              value={status}
              onChange={setStatus}
              options={INCIDENT_STATUSES.map((s) => ({ value: s, label: cap(s) }))}
            />
          </div>
          <label htmlFor="u-msg" className="sr-only">
            Update message
          </label>
          <textarea
            id="u-msg"
            rows={3}
            required
            className="mt-3 block w-full resize-y rounded-md border-0 bg-surface px-3 py-2 text-base text-text"
            placeholder="What changed? This is shown publicly."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {(postErrors.byId['u-msg'] ?? postErrors.rest.length > 0) && (
            <p role="alert" className="m-0 mt-2 text-base text-bad-text">
              {postErrors.byId['u-msg'] ?? postErrors.rest.join(' · ')}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base text-sec">
              <Switch checked={notify} onChange={setNotify} label="Notify channels" /> Notify channels
            </span>
            <button type="submit" className="btn-primary" disabled={post.isPending}>
              {post.isPending ? 'Posting…' : 'Post update'}
            </button>
          </div>
        </form>
      )}
      <ol className="m-0 mt-4 list-none p-0">
        {incident.updates.map((u) => (
          <li key={u.id} className="flex gap-3 border-t border-hair py-2">
            <span className="w-24 shrink-0 pt-px text-xs text-sec">{dateTime(u.createdAt)}</span>
            <span className="min-w-0">
              <span className="block text-base font-medium">
                {cap(u.status)}
                {u.author && <span className="font-normal text-sec"> · {u.author}</span>}
              </span>
              <span className="block whitespace-pre-line text-sec">{u.message}</span>
            </span>
          </li>
        ))}
      </ol>
      {canDelete && (
        <button
          type="button"
          className="btn-danger mt-2"
          disabled={remove.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: 'Delete this incident?',
                message: 'It disappears from the status page and its history. This cannot be undone.',
                confirm: 'Delete incident',
              })
            )
              remove.mutate();
          }}
        >
          <Icon name="trash" size={16} /> Delete incident
        </button>
      )}
    </div>
  );
}

export function IncidentsPage() {
  const incidents = useIncidents(false);
  const me = useMe();
  // A link from the public incident page opens that incident directly.
  const { incident: linked } = useSearch({ strict: false }) as { incident?: string };
  const navigate = useNavigate();
  const [picked, setSelected] = useState<string | null>(linked ?? null);
  const canWrite = can(me.data?.role, 'editor');
  if (incidents.isPending) return <Spinner />;
  if (incidents.error) return <ErrorNote error={incidents.error} />;
  const selected = picked ?? incidents.data[0]?.id ?? null;
  const current = incidents.data.find((i) => i.id === selected);
  const active = incidents.data.filter((i) => i.resolvedAt === null).length;

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle={`${active} ongoing · updates appear on the status page and go to the notification channels`}
        actions={
          canWrite && (
            <button type="button" className="btn-primary" onClick={() => setSelected('__new')}>
              <Icon name="plus" size={16} /> Declare incident
            </button>
          )
        }
      />
      <div className="flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[1_1_280px]">
          {incidents.data.length === 0 && (
            <EmptyState title="No incidents yet">
              Declare one when users are affected; it appears on the status page.
            </EmptyState>
          )}
          {incidents.data.map((i, idx) => (
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the nested text
            <button
              key={i.id}
              type="button"
              onClick={() => setSelected(i.id)}
              aria-current={selected === i.id ? 'true' : undefined}
              className={`row-btn ${idx === 0 ? 'border-t-0' : ''} ${selected === i.id ? 'bg-sel' : ''}`}
            >
              <span
                aria-hidden="true"
                className="block h-2 w-2 shrink-0 rounded-full"
                style={{ background: i.resolvedAt ? 'var(--fill-2)' : incidentTone(i).dot }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{i.title}</span>
                <span className="block text-xs text-sec">
                  {i.services.map((s) => s.name).join(', ') || 'no services'} · {dateTime(i.createdAt)} ·{' '}
                  {cap(i.status)}
                </span>
              </span>
            </button>
          ))}
        </Section>
        <Section className="min-w-0 flex-[999_1_420px]">
          {selected === '__new' ? (
            <Declare onDone={(i) => setSelected(i.id)} />
          ) : current ? (
            <Detail
              key={current.id}
              incident={current}
              canWrite={canWrite}
              canDelete={can(me.data?.role, 'admin')}
              onDeleted={() => {
                setSelected(null);
                // Drop a stale ?incident= link so the list falls back to the newest incident.
                if (linked) void navigate({ to: '/admin/incidents', search: {}, replace: true });
              }}
            />
          ) : (
            <Empty>Select an incident</Empty>
          )}
        </Section>
      </div>
    </>
  );
}

export { ServicePicker };
