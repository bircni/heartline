import type { GroupDto } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '../../components/Dialog.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Switch } from '../../components/Switch.tsx';
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
import { api, useAdminMonitors, useGroups, useMe } from '../../lib/api.ts';
import { can } from '../../lib/roles.ts';

function Editor({ existing, onDone }: { existing: GroupDto | null; onDone: (g: GroupDto | null) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [collapsed, setCollapsed] = useState(existing?.collapsed ?? false);
  const [hide, setHide] = useState(existing?.hideUnlessDegraded ?? false);
  const save = useMutation({
    mutationFn: () => {
      const json = { name, description: description || null, collapsed, hideUnlessDegraded: hide };
      return existing
        ? api<GroupDto>(`/api/v1/admin/groups/${existing.id}`, { method: 'PUT', json })
        : api<GroupDto>('/api/v1/admin/groups', { method: 'POST', json });
    },
    onSuccess: async (g) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
      await qc.invalidateQueries({ queryKey: ['overview'] });
      toast(existing ? `Saved ${g.name}` : `Created ${g.name}`);
      if (!existing) {
        setName('');
        setDescription('');
      }
      onDone(g);
    },
  });
  const errors = fieldErrorsOf(save.error, { name: 'g-name', description: 'g-desc' });
  return (
    <form
      className="p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">{existing ? `Edit ${existing.name}` : 'New group'}</h2>
        {existing && (
          <button type="button" className="btn-sm" onClick={() => onDone(null)}>
            Cancel
          </button>
        )}
      </div>
      <FieldErrors errors={errors.byId}>
        <Field label="Name" htmlFor="g-name">
          <input
            id="g-name"
            className="field"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description (public)" htmlFor="g-desc" hint="Shown as a tooltip next to the group name">
          <textarea
            id="g-desc"
            rows={2}
            className="field h-auto resize-y py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </FieldErrors>
      <div className="mt-3 flex items-center justify-between rounded-md bg-fill px-3 py-2">
        <span className="text-base">Collapsed by default</span>
        <Switch label="Collapsed by default" checked={collapsed} onChange={setCollapsed} />
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md bg-fill px-3 py-2">
        <span className="text-base">Hide from visitors while operational</span>
        <Switch label="Hide from visitors while operational" checked={hide} onChange={setHide} />
      </div>
      {errors.rest.length > 0 && (
        <div className="mt-3" role="alert">
          <Notice tone="bad">{errors.rest.join(' · ')}</Notice>
        </div>
      )}
      <button type="submit" className="btn-primary mt-4 w-full" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create group'}
      </button>
    </form>
  );
}

export function GroupsPage() {
  const groups = useGroups();
  const monitors = useAdminMonitors();
  const me = useMe();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isAdmin = can(me.data?.role, 'admin');
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const remove = useMutation({
    mutationFn: (g: GroupDto) => api(`/api/v1/admin/groups/${g.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, g) => {
      if (editing === g.id) setEditing(null);
      await refresh();
      toast(`Deleted ${g.name}`);
    },
    meta: { errorToast: true },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`/api/v1/admin/groups/order`, { method: 'PUT', json: { ids } }),
    onSuccess: refresh,
    meta: { errorToast: true },
  });
  if (groups.isPending) return <Spinner />;
  if (groups.error) return <ErrorNote error={groups.error} />;
  const uiGroups = groups.data.filter((g) => g.source === 'db');
  const move = (g: GroupDto, by: -1 | 1) => {
    const ids = uiGroups.map((x) => x.id);
    const i = ids.indexOf(g.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    reorder.mutate(ids);
  };
  const count = (id: string) => monitors.data?.filter((m) => m.groupId === id).length ?? 0;

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Groups order the status page. Groups from status.yaml come first and are edited there."
      />
      <div className="flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          {groups.data.length === 0 && (
            <EmptyState title="No groups yet">
              Groups are created with the first monitor in them, or here.
            </EmptyState>
          )}
          {groups.data.map((g, i) => {
            const uiIndex = uiGroups.findIndex((x) => x.id === g.id);
            return (
              <div
                key={g.id}
                className={`flex items-center gap-3 px-4 py-2.5 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {g.name} <span className="font-mono text-xs font-normal text-muted">{g.id}</span>
                  </span>
                  <span className="block text-xs text-sec">
                    {count(g.id)} services
                    {g.collapsed && ' · collapsed'}
                    {g.hideUnlessDegraded && ' · hidden while operational'}
                    {g.description && ` · ${g.description}`}
                  </span>
                </span>
                {g.source === 'config' ? (
                  <span className="flex items-center gap-1 text-xs text-sec">
                    <Icon name="lock" size={14} /> yaml
                  </span>
                ) : (
                  isAdmin && (
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move ${g.name} up`}
                        disabled={uiIndex <= 0 || reorder.isPending}
                        onClick={() => move(g, -1)}
                      >
                        <Icon name="chevron" size={15} className="-rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move ${g.name} down`}
                        disabled={uiIndex === uiGroups.length - 1 || reorder.isPending}
                        onClick={() => move(g, 1)}
                      >
                        <Icon name="chevron" size={15} className="rotate-90" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Edit ${g.name}`}
                        onClick={() => setEditing(g.id)}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn text-bad-text hover:text-bad-text"
                        aria-label={`Delete ${g.name}`}
                        disabled={remove.isPending}
                        onClick={async () => {
                          if (count(g.id) > 0) {
                            toast(`Move or delete the ${count(g.id)} services in ${g.name} first.`, 'bad');
                            return;
                          }
                          if (await confirm({ title: `Delete group ${g.name}?`, confirm: 'Delete group' }))
                            remove.mutate(g);
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </span>
                  )
                )}
              </div>
            );
          })}
        </Section>
        {isAdmin && (
          <Section className="min-w-0 flex-[1_1_300px]">
            <Editor
              key={editing ?? '__new'}
              existing={groups.data.find((g) => g.id === editing) ?? null}
              onDone={() => setEditing(null)}
            />
          </Section>
        )}
      </div>
    </>
  );
}
