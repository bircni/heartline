import type { ComponentStatus, Impact, Incident, IncidentStatus, TemplateDto } from '@heartline/shared';
import {
  COMPONENT_STATUSES,
  IMPACTS,
  INCIDENT_STATUSES,
  defaultComponentStatus,
  deriveImpact,
} from '@heartline/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { MarkdownField } from '../../components/MarkdownField.tsx';
import { UpdateTimeline } from '../../components/UpdateTimeline.tsx';
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
import { api, useAdminIncident, useAdminMonitors, useIncidents, useMe, useTemplates } from '../../lib/api.ts';
import {
  COMPONENT_LABEL,
  COMPONENT_TONE,
  IMPACT_LABEL,
  dateTime,
  duration,
  fromZonedInput,
  incidentTone,
  toZonedInput,
} from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Affected = { id: string; status: ComponentStatus };

/** Services to pick, as toggles. Maintenance windows use it too. */
function ServicePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const monitors = useAdminMonitors();
  return (
    <div role="group" aria-label="Services" className="flex flex-wrap gap-2">
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

/** Affected services, each with the status the incident gives it on the status page. */
function AffectedPicker({
  value,
  onChange,
  fallback,
}: {
  value: Affected[];
  onChange: (v: Affected[]) => void;
  /** Status for a newly picked service. */
  fallback: ComponentStatus;
}) {
  const monitors = useAdminMonitors();
  return (
    <>
      <ServicePicker
        value={value.map((a) => a.id)}
        onChange={(ids) =>
          onChange(ids.map((id) => value.find((a) => a.id === id) ?? { id, status: fallback }))
        }
      />
      {value.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {value.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-base">
              <span className="min-w-0 flex-1 truncate">
                {monitors.data?.find((m) => m.id === a.id)?.name ?? a.id}
              </span>
              <select
                className="field h-7 w-auto py-0 text-xs"
                aria-label={`Status of ${monitors.data?.find((m) => m.id === a.id)?.name ?? a.id}`}
                value={a.status}
                onChange={(e) =>
                  onChange(
                    value.map((x) =>
                      x.id === a.id ? { ...x, status: e.target.value as ComponentStatus } : x,
                    ),
                  )
                }
                style={{ color: COMPONENT_TONE[a.status].text }}
              >
                {COMPONENT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {COMPONENT_LABEL[st]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

/** Impact: follows the services ("auto") or set by hand. */
function ImpactPicker({
  value,
  onChange,
  derived,
}: {
  value: Impact | 'auto';
  onChange: (v: Impact | 'auto') => void;
  derived: Impact | null;
}) {
  return (
    <Segmented
      size="sm"
      label="Impact"
      value={value}
      onChange={onChange}
      options={[
        ...(derived ? [{ value: 'auto' as const, label: `Auto: ${IMPACT_LABEL[derived]}` }] : []),
        ...IMPACTS.map((i) => ({ value: i, label: IMPACT_LABEL[i] })),
      ]}
    />
  );
}

/** "Happened earlier": a past time for an incident or update written up afterwards. */
function BackfillField({
  value,
  onChange,
  id,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  id: string;
}) {
  return (
    <div className="mt-3">
      <label className="flex items-center gap-2 text-base text-sec">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? toZonedInput(Date.now() - 3_600_000) : null)}
        />
        Happened earlier (no notifications)
      </label>
      {value !== null && (
        <input
          id={id}
          aria-label="When it happened"
          type="datetime-local"
          className="field mt-1.5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function Declare({ onDone }: { onDone: (i: Incident) => void }) {
  const qc = useQueryClient();
  const templates = useTemplates('incident');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<IncidentStatus>('investigating');
  const [impact, setImpact] = useState<Impact | 'auto'>('auto');
  const [services, setServices] = useState<Affected[]>([]);
  const [notify, setNotify] = useState(true);
  const [earlier, setEarlier] = useState<string | null>(null);
  const derived = services.length ? deriveImpact(services.map((s) => s.status)) : null;
  // Without services the impact cannot follow them.
  const chosen = impact === 'auto' && !derived ? 'degraded' : impact;
  const applyTemplate = (t: TemplateDto) => {
    setTitle(t.title);
    setMessage(t.body);
    if (t.status) setStatus(t.status);
    setImpact(t.impact ?? 'auto');
    setServices(
      t.services.map((s) => ({
        id: s.id,
        status: s.status ?? defaultComponentStatus(t.impact ?? undefined),
      })),
    );
  };
  const create = useMutation({
    mutationFn: () =>
      api<Incident>('/api/v1/admin/incidents', {
        method: 'POST',
        json: {
          title,
          message,
          status,
          impact: chosen === 'auto' ? undefined : chosen,
          services,
          notify: notify && earlier === null,
          createdAt: earlier ? new Date(fromZonedInput(earlier)).toISOString() : undefined,
        },
      }),
    onSuccess: async (i) => {
      await qc.invalidateQueries({ queryKey: ['incidents'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      toast(`Declared ${i.title}`);
      onDone(i);
    },
  });
  const createErrors = fieldErrorsOf(create.error, {
    title: 'i-title',
    message: 'i-msg',
    createdAt: 'i-when',
  });
  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">Declare incident</h2>
        {(templates.data?.length ?? 0) > 0 && (
          <select
            aria-label="Start from a template"
            className="field h-7 w-auto py-0 text-xs"
            value=""
            onChange={(e) => {
              const t = templates.data?.find((x) => x.id === e.target.value);
              if (t) applyTemplate(t);
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
          <div className="label">Affected services and their status</div>
          <AffectedPicker value={services} onChange={setServices} fallback="degraded" />
        </div>
        <div className="mt-3">
          <div className="label">Impact</div>
          <ImpactPicker value={chosen} onChange={setImpact} derived={derived} />
        </div>
        <div className="mt-3">
          <div className="label">Status</div>
          <Segmented
            size="sm"
            label="Status"
            value={status}
            onChange={setStatus}
            options={INCIDENT_STATUSES.map((st) => ({ value: st, label: cap(st) }))}
          />
        </div>
        <Field label="First update (public)" htmlFor="i-msg">
          <MarkdownField
            id="i-msg"
            required
            value={message}
            onChange={setMessage}
            placeholder="We are investigating reports of…"
          />
        </Field>
        <BackfillField id="i-when" value={earlier} onChange={setEarlier} />
      </FieldErrors>
      {createErrors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{createErrors.rest.join(' · ')}</Notice>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base text-sec">
          <Switch
            checked={notify && earlier === null}
            disabled={earlier !== null}
            onChange={setNotify}
            label="Notify channels"
          />{' '}
          Notify channels
        </span>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Declaring…' : 'Declare'}
        </button>
      </div>
    </form>
  );
}

function Postmortem({ incident, canWrite }: { incident: Incident; canWrite: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [body, setBody] = useState(incident.postmortem?.body ?? '');
  const [notify, setNotify] = useState(false);
  const published = incident.postmortem?.publishedAt !== null && incident.postmortem !== null;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['incidents'] });
    await qc.invalidateQueries({ queryKey: ['incident', incident.id] });
  };
  const save = useMutation({
    mutationFn: (publish: boolean) =>
      api<Incident>(`/api/v1/admin/incidents/${incident.id}/postmortem`, {
        method: 'PUT',
        json: { body, publish, notify: publish && notify },
      }),
    onSuccess: async (_i, publish) => {
      await refresh();
      toast(publish ? (published ? 'Postmortem updated' : 'Postmortem published') : 'Draft saved');
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      api<Incident>(`/api/v1/admin/incidents/${incident.id}/postmortem`, { method: 'DELETE' }),
    onSuccess: async () => {
      setBody('');
      await refresh();
      toast('Postmortem deleted');
    },
    meta: { errorToast: true },
  });
  if (!canWrite && !incident.postmortem) return null;
  return (
    <section className="mt-4 rounded-xl bg-fill p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-base font-semibold">Postmortem</h3>
        <span className="text-xs text-sec">
          {incident.postmortem
            ? published
              ? `Published ${dateTime(incident.postmortem.publishedAt as number)}`
              : 'Draft, not public'
            : 'None yet'}
        </span>
      </div>
      {canWrite ? (
        <>
          <MarkdownField
            id="pm-body"
            label="Postmortem"
            className="mt-2"
            rows={8}
            value={body}
            onChange={setBody}
            placeholder={'## What happened\n\n## Why\n\n## What we change'}
          />
          {save.error && (
            <p role="alert" className="m-0 mt-2 text-base text-bad-text">
              {save.error.message}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!published && (
              <span className="flex items-center gap-2 text-base text-sec">
                <Switch checked={notify} onChange={setNotify} label="Notify channels on publish" /> Notify on
                publish
              </span>
            )}
            <span className="flex-1" />
            {incident.postmortem && (
              <button
                type="button"
                className="btn-sm text-bad-text"
                disabled={remove.isPending}
                onClick={async () => {
                  if (await confirm({ title: 'Delete the postmortem?', confirm: 'Delete' })) remove.mutate();
                }}
              >
                Delete
              </button>
            )}
            {published ? (
              <button
                type="button"
                className="btn-sm"
                disabled={save.isPending || !body.trim()}
                onClick={() => save.mutate(false)}
              >
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                className="btn-sm"
                disabled={save.isPending || !body.trim()}
                onClick={() => save.mutate(false)}
              >
                Save draft
              </button>
            )}
            <button
              type="button"
              className="btn-primary h-7 px-3 text-xs"
              disabled={save.isPending || !body.trim()}
              onClick={() => save.mutate(true)}
            >
              {published ? 'Update' : 'Publish'}
            </button>
          </div>
        </>
      ) : (
        incident.postmortem && <Markdown text={incident.postmortem.body} className="mt-2" />
      )}
    </section>
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
  const [status, setStatus] = useState<IncidentStatus>(
    incident.status === 'resolved' ? 'resolved' : incident.status,
  );
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState(true);
  const [earlier, setEarlier] = useState<string | null>(null);
  // Statuses to post with the update; services left unchanged are not sent.
  const [changes, setChanges] = useState<Affected[]>(
    incident.services.map((s) => ({ id: s.id, status: s.status })),
  );
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['incidents'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const changed = changes.filter((c) => incident.services.find((s) => s.id === c.id)?.status !== c.status);
  const post = useMutation({
    mutationFn: () =>
      api<Incident>(`/api/v1/admin/incidents/${incident.id}/updates`, {
        method: 'POST',
        json: {
          status,
          message,
          notify: notify && earlier === null,
          services: changed.length ? changed : undefined,
          createdAt: earlier ? new Date(fromZonedInput(earlier)).toISOString() : undefined,
        },
      }),
    onSuccess: async () => {
      setMessage('');
      setEarlier(null);
      await refresh();
      toast('Update posted');
    },
  });
  const postErrors = fieldErrorsOf(post.error, { message: 'u-msg', createdAt: 'u-when' });
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
  const [impact, setImpact] = useState<Impact | 'auto'>(incident.impactOverride ? incident.impact : 'auto');
  const [services, setServices] = useState<Affected[]>(
    incident.services.map((s) => ({ id: s.id, status: s.status })),
  );
  const editDerived = services.length ? deriveImpact(services.map((s) => s.status)) : null;
  const edit = useMutation({
    mutationFn: () =>
      api<Incident>(`/api/v1/admin/incidents/${incident.id}`, {
        method: 'PATCH',
        json: { title, impact: impact === 'auto' ? null : impact, services },
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
            {cap(incident.status)} · {IMPACT_LABEL[incident.impact]}
            {incident.impactOverride ? ' (set by hand)' : ''}
          </div>
          <h2 className="m-0 mt-0.5 text-2xl font-medium">{incident.title}</h2>
          <div className="text-xs text-sec">
            {dateTime(incident.createdAt)} · {duration(incident.createdAt, incident.resolvedAt)}
            {incident.automatic && ' · automatic'}
          </div>
          {incident.services.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
              {incident.services.map((s) => (
                <span key={s.id} className="text-sec">
                  {s.name}:{' '}
                  <span className="font-medium" style={{ color: COMPONENT_TONE[s.status].text }}>
                    {COMPONENT_LABEL[s.status]}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        {canWrite && !editing && (
          <button type="button" className="btn-sm shrink-0" onClick={() => setEditing(true)}>
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
            <div className="label">Affected services</div>
            <AffectedPicker value={services} onChange={setServices} fallback="degraded" />
          </div>
          <div className="mt-3">
            <div className="label">Impact</div>
            <div className="rounded-md bg-bg p-0.5">
              <ImpactPicker
                value={impact === 'auto' && !editDerived ? incident.impact : impact}
                onChange={setImpact}
                derived={editDerived}
              />
            </div>
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
              onChange={(next) => {
                setStatus(next);
                // Resolving usually means the services are fine again.
                if (next === 'resolved') setChanges(changes.map((c) => ({ ...c, status: 'operational' })));
              }}
              options={INCIDENT_STATUSES.map((st) => ({ value: st, label: cap(st) }))}
            />
          </div>
          <FieldErrors errors={postErrors.byId}>
            <label htmlFor="u-msg" className="sr-only">
              Update message
            </label>
            <MarkdownField
              id="u-msg"
              className="mt-3"
              rows={3}
              required
              value={message}
              onChange={setMessage}
              placeholder="What changed? This is shown publicly."
            />
            {postErrors.byId['u-msg'] && (
              <p className="m-0 mt-1 text-xs text-bad-text">{postErrors.byId['u-msg']}</p>
            )}
            {changes.length > 0 && (
              <div className="mt-3">
                <div className="label">Service statuses with this update</div>
                <AffectedPicker value={changes} onChange={setChanges} fallback="degraded" />
              </div>
            )}
            <BackfillField id="u-when" value={earlier} onChange={setEarlier} />
          </FieldErrors>
          {postErrors.rest.length > 0 && (
            <p role="alert" className="m-0 mt-2 text-base text-bad-text">
              {postErrors.rest.join(' · ')}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-base text-sec">
              <Switch
                checked={notify && earlier === null}
                disabled={earlier !== null}
                onChange={setNotify}
                label="Notify channels"
              />{' '}
              Notify channels
            </span>
            <button type="submit" className="btn-primary" disabled={post.isPending}>
              {post.isPending ? 'Posting…' : 'Post update'}
            </button>
          </div>
        </form>
      )}
      <div className="mt-4 border-t border-hair pt-3">
        <UpdateTimeline updates={incident.updates} accent={incidentTone(incident).text} />
      </div>
      <Postmortem
        key={`${incident.id}-${incident.postmortem?.publishedAt ?? 'draft'}`}
        incident={incident}
        canWrite={canWrite}
      />
      {canDelete && (
        <button
          type="button"
          className="btn-danger mt-4"
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
  const detail = useAdminIncident(picked && picked !== '__new' ? picked : (incidents.data?.[0]?.id ?? null));
  const canWrite = can(me.data?.role, 'editor');
  if (incidents.isPending) return <Spinner />;
  if (incidents.error) return <ErrorNote error={incidents.error} />;
  const selected = picked ?? incidents.data[0]?.id ?? null;
  const listed = incidents.data.find((i) => i.id === selected);
  // The admin view adds an unpublished postmortem; the list entry shows until it loads.
  const current = detail.data?.id === selected ? detail.data : listed;
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
              key={`${current.id}-${current.updatedAt}`}
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
