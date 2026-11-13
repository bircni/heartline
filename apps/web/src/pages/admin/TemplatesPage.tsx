import type { ComponentStatus, Impact, IncidentStatus, TemplateDto } from '@heartline/shared';
import { COMPONENT_STATUSES, IMPACTS, INCIDENT_STATUSES, formatDuration } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '../../components/Dialog.tsx';
import { Icon } from '../../components/Icon.tsx';
import { MarkdownField } from '../../components/MarkdownField.tsx';
import { Segmented } from '../../components/Segmented.tsx';
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
import { api, useAdminMonitors, useMe, useTemplates } from '../../lib/api.ts';
import { COMPONENT_LABEL, IMPACT_LABEL } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Editor({ existing, onDone }: { existing: TemplateDto | null; onDone: () => void }) {
  const qc = useQueryClient();
  const monitors = useAdminMonitors();
  const [kind, setKind] = useState<TemplateDto['kind']>(existing?.kind ?? 'incident');
  const [name, setName] = useState(existing?.name ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [status, setStatus] = useState<IncidentStatus>(existing?.status ?? 'investigating');
  const [impact, setImpact] = useState<Impact | ''>(existing?.impact ?? '');
  const [duration, setDuration] = useState(existing?.durationMs ? formatDuration(existing.durationMs) : '1h');
  const [services, setServices] = useState<{ id: string; status: ComponentStatus | '' }[]>(
    existing?.services.map((s) => ({ id: s.id, status: s.status ?? '' })) ?? [],
  );
  const save = useMutation({
    mutationFn: () => {
      const json = {
        kind,
        name,
        title,
        body,
        ...(kind === 'incident' ? { status, impact: impact || undefined } : { duration }),
        services: services.map((s) => (s.status ? { id: s.id, status: s.status } : s.id)),
      };
      return existing
        ? api<TemplateDto>(`/api/v1/admin/templates/${existing.id}`, { method: 'PUT', json })
        : api<TemplateDto>('/api/v1/admin/templates', { method: 'POST', json });
    },
    onSuccess: async (t) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'templates'] });
      toast(existing ? `Saved ${t.name}` : `Created ${t.name}`);
      onDone();
    },
  });
  const errors = fieldErrorsOf(save.error, {
    name: 't-name',
    title: 't-title',
    body: 't-body',
    duration: 't-duration',
  });
  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">{existing ? `Edit ${existing.name}` : 'New template'}</h2>
        {existing && (
          <button type="button" className="btn-sm" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      <div className="mt-3">
        <Segmented
          size="sm"
          label="Template for"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'incident', label: 'Incident' },
            { value: 'maintenance', label: 'Maintenance' },
          ]}
        />
      </div>
      <FieldErrors errors={errors.byId}>
        <Field label="Template name" htmlFor="t-name" hint="Shown in the template picker">
          <input
            id="t-name"
            className="field"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={kind === 'incident' ? 'Incident title' : 'Maintenance title'} htmlFor="t-title">
          <input
            id="t-title"
            className="field"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={kind === 'incident' ? 'First update' : 'Description'} htmlFor="t-body">
          <MarkdownField id="t-body" value={body} onChange={setBody} />
        </Field>
        {kind === 'incident' ? (
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Status" htmlFor="t-status">
              <select
                id="t-status"
                className="field"
                value={status}
                onChange={(e) => setStatus(e.target.value as IncidentStatus)}
              >
                {INCIDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {cap(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Impact" htmlFor="t-impact">
              <select
                id="t-impact"
                className="field"
                value={impact}
                onChange={(e) => setImpact(e.target.value as Impact | '')}
              >
                <option value="">Follow the services</option>
                {IMPACTS.map((i) => (
                  <option key={i} value={i}>
                    {IMPACT_LABEL[i]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <Field label="Duration" htmlFor="t-duration" hint="e.g. 30m, 2h">
            <input
              id="t-duration"
              className="field"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
        )}
      </FieldErrors>
      <div className="mt-3">
        <div className="label">Services</div>
        <div role="group" aria-label="Services" className="flex flex-wrap gap-2">
          {monitors.data?.map((m) => {
            const on = services.some((s) => s.id === m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setServices(
                    on ? services.filter((s) => s.id !== m.id) : [...services, { id: m.id, status: '' }],
                  )
                }
                className={`h-7 rounded-md px-3 text-xs font-medium ${on ? 'bg-text text-bg' : 'bg-fill text-text'}`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
        {kind === 'incident' &&
          services.map((s) => (
            <label key={s.id} className="mt-1.5 flex items-center gap-2 text-base">
              <span className="min-w-0 flex-1 truncate">
                {monitors.data?.find((m) => m.id === s.id)?.name ?? s.id}
              </span>
              <select
                className="field h-7 w-auto py-0 text-xs"
                value={s.status}
                onChange={(e) =>
                  setServices(
                    services.map((x) =>
                      x.id === s.id ? { ...x, status: e.target.value as ComponentStatus | '' } : x,
                    ),
                  )
                }
              >
                <option value="">From the impact</option>
                {COMPONENT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {COMPONENT_LABEL[st]}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>
      {errors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{errors.rest.join(' · ')}</Notice>
        </div>
      )}
      <button type="submit" className="btn-primary mt-4 w-full" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create template'}
      </button>
    </form>
  );
}

export function TemplatesPage() {
  const templates = useTemplates();
  const me = useMe();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canWrite = can(me.data?.role, 'editor');
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (t: TemplateDto) => api(`/api/v1/admin/templates/${t.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, t) => {
      if (editing === t.id) setEditing(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'templates'] });
      toast(`Deleted ${t.name}`);
    },
    meta: { errorToast: true },
  });
  if (templates.isPending) return <Spinner />;
  if (templates.error) return <ErrorNote error={templates.error} />;
  return (
    <>
      <PageHeader title="Templates" subtitle="Start incidents and maintenance windows from prepared text." />
      <div className="flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          {templates.data.length === 0 && (
            <EmptyState title="No templates yet">
              Prepare the wording for outages you expect, e.g. a database failover.
            </EmptyState>
          )}
          {templates.data.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 px-4 py-2.5 ${i ? 'border-t border-hair' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.name}</span>
                <span className="block truncate text-xs text-sec">
                  {cap(t.kind)} · {t.title}
                  {t.impact && ` · ${IMPACT_LABEL[t.impact]}`}
                  {t.durationMs && ` · ${formatDuration(t.durationMs)}`}
                </span>
              </span>
              {t.source === 'config' ? (
                <span className="flex items-center gap-1 text-xs text-sec">
                  <Icon name="lock" size={14} /> yaml
                </span>
              ) : (
                canWrite && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Edit ${t.name}`}
                      onClick={() => setEditing(t.id)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn text-bad-text hover:text-bad-text"
                      aria-label={`Delete ${t.name}`}
                      disabled={remove.isPending}
                      onClick={async () => {
                        if (
                          await confirm({ title: `Delete template ${t.name}?`, confirm: 'Delete template' })
                        )
                          remove.mutate(t);
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                )
              )}
            </div>
          ))}
        </Section>
        {canWrite && (
          <Section className="min-w-0 flex-[1_1_320px]">
            <Editor
              key={editing ?? '__new'}
              existing={templates.data.find((t) => t.id === editing) ?? null}
              onDone={() => setEditing(null)}
            />
          </Section>
        )}
      </div>
    </>
  );
}
