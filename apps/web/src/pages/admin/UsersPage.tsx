import type { Role, UserDto } from '@heartline/shared';
import { ROLES } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { useConfirm } from '../../components/Dialog.tsx';
import { toast } from '../../components/Toast.tsx';
import {
  Avatar,
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
import { api, useBootstrap, useMe, useUsers } from '../../lib/api.ts';
import { dateTime } from '../../lib/format.ts';

export function UsersPage() {
  const users = useUsers();
  const me = useMe();
  const boot = useBootstrap();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'viewer' as Role });
  const confirm = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api<UserDto>(`/api/v1/admin/users/${id}`, { method: 'PATCH', json: { role } }),
    onSuccess: async (u) => {
      await refresh();
      toast(`${u.name} is now ${u.role}`);
    },
    meta: { errorToast: true },
  });
  const remove = useMutation({
    mutationFn: (u: UserDto) => api(`/api/v1/admin/users/${u.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, u) => {
      await refresh();
      toast(`Deleted ${u.name}`);
    },
    meta: { errorToast: true },
  });
  const create = useMutation({
    mutationFn: () => api<UserDto>('/api/v1/admin/users', { method: 'POST', json: form }),
    onSuccess: async (u) => {
      setForm({ name: '', email: '', password: '', role: 'viewer' });
      await refresh();
      toast(`Added ${u.name}`);
    },
  });
  const createErrors = fieldErrorsOf(create.error, {
    name: 'u-name',
    email: 'u-email',
    password: 'u-pass',
    role: 'u-role',
  });
  if (users.isPending) return <Spinner />;
  if (users.error) return <ErrorNote error={users.error} />;
  const local = boot.data?.auth.local ?? true;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Single sign-on users get their role from group membership on every sign-in. Seeded users follow status.yaml."
      />
      <div className="flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          {users.data.length === 0 && (
            <EmptyState title="No users yet">Users appear here after their first sign-in.</EmptyState>
          )}
          {users.data.map((u, i) => (
            <div
              key={u.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${i ? 'border-t border-hair' : ''}`}
            >
              <Avatar name={u.name} image={u.image} size={32} />
              <span className="min-w-0 flex-[1_1_180px]">
                <span className="block font-medium">
                  {u.name}
                  {u.id === me.data?.id && <span className="text-sec"> (you)</span>}
                </span>
                <span className="block truncate text-xs text-sec">
                  {u.email} ·{' '}
                  {u.providers.map((p) => (p === 'credential' ? 'local' : p)).join(', ') ||
                    'no sign-in method'}{' '}
                  · since {dateTime(u.createdAt)}
                </span>
              </span>
              <label className="sr-only" htmlFor={`role-${u.id}`}>
                Role of {u.name}
              </label>
              <select
                id={`role-${u.id}`}
                className="field h-8 w-28"
                value={u.role}
                disabled={u.id === me.data?.id}
                onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {u.id !== me.data?.id && (
                <button
                  type="button"
                  className="btn-danger h-8 px-3"
                  aria-label={`Delete ${u.name}`}
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete ${u.name}?`,
                        message: 'Their API tokens are revoked and they can no longer sign in.',
                        confirm: 'Delete user',
                      })
                    )
                      remove.mutate(u);
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          ))}
        </Section>
        {local && (
          <Section className="min-w-0 flex-[1_1_300px] p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <FieldErrors errors={createErrors.byId}>
                <h2 className="m-0 text-lg font-medium">Add local user</h2>
                <Field label="Name" htmlFor="u-name">
                  <input
                    id="u-name"
                    className="field"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field label="E-mail" htmlFor="u-email">
                  <input
                    id="u-email"
                    type="email"
                    className="field"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </Field>
                <Field label="Initial password" htmlFor="u-pass" hint="At least 12 characters.">
                  <input
                    id="u-pass"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    className="field"
                    required
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </Field>
                <Field label="Role" htmlFor="u-role">
                  <select
                    id="u-role"
                    className="field"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
              </FieldErrors>
              {createErrors.rest.length > 0 && (
                <div className="mt-3" role="alert">
                  <Notice tone="bad">{createErrors.rest.join(' · ')}</Notice>
                </div>
              )}
              <button type="submit" className="btn-primary mt-4 w-full" disabled={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add user'}
              </button>
            </form>
          </Section>
        )}
      </div>
    </>
  );
}
