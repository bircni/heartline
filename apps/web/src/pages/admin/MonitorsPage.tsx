import type { AdminMonitor, MonitorKind, MonitorSpecInput } from '@heartline/shared';
import { MONITOR_KINDS, formatDuration } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Segmented } from '../../components/Segmented.tsx';
import { StatusDot, StatusPill } from '../../components/Status.tsx';
import { Switch } from '../../components/Switch.tsx';
import { ErrorNote, Field, Notice, PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { api, useAdminMonitors, useMe, useNotifiers, usePlugins } from '../../lib/api.ts';
import { ms, relative } from '../../lib/format.ts';
import { can } from './AdminLayout.tsx';

type Draft = { group: string; spec: Record<string, unknown> };

const num = (v: string) => (v === '' ? undefined : Number(v));

const KIND_LABEL: Record<MonitorKind, string> = {
  http: 'HTTP',
  tcp: 'TCP',
  dns: 'DNS',
  tls: 'TLS',
  icmp: 'Ping',
  plugin: 'Plugin',
};

function emptyDraft(kind: MonitorKind = 'http'): Draft {
  return {
    group: 'Services',
    spec: { id: '', name: '', type: kind, interval: '60s', failureThreshold: 2, notify: [] },
  };
}

function toDraft(m: AdminMonitor): Draft {
  const spec: Record<string, unknown> = {
    ...m.spec,
    interval: formatDuration(m.spec.interval),
    timeout: formatDuration(m.spec.timeout),
  };
  if ('degradedAfter' in m.spec && m.spec.degradedAfter !== undefined)
    spec.degradedAfter = formatDuration(m.spec.degradedAfter);
  return { group: m.group, spec };
}

/** Removes empty optional strings so the server applies its defaults. */
function clean(spec: Record<string, unknown>): MonitorSpecInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) {
    if (v === '' || v === undefined) continue;
    out[k] = v;
  }
  return out as MonitorSpecInput;
}

function TextField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  mono = true,
  hint,
}: {
  id: string;
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        className={`field ${mono ? 'font-mono text-[13px]' : ''}`}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </Field>
  );
}

function Editor({
  draft,
  setDraft,
  locked,
  isNew,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  locked: boolean;
  isNew: boolean;
}) {
  const plugins = usePlugins();
  const notifiers = useNotifiers();
  const s = draft.spec;
  const set = (key: string, value: unknown) => setDraft({ ...draft, spec: { ...s, [key]: value } });
  const kind = s.type as MonitorKind;
  const plugin = plugins.data?.find((p) => p.name === s.plugin);
  const expect = (s.expect ?? {}) as Record<string, unknown>;

  return (
    <>
      {isNew && (
        <div className="mt-1">
          <Segmented
            size="sm"
            label="Check type"
            value={kind}
            onChange={(k) => setDraft({ ...draft, spec: { ...emptyDraft(k).spec, id: s.id, name: s.name } })}
            options={MONITOR_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-x-3">
        <TextField
          id="m-name"
          label="Name"
          mono={false}
          value={s.name}
          onChange={(v) => set('name', v)}
          disabled={locked}
        />
        <TextField
          id="m-id"
          label="ID"
          value={s.id}
          onChange={(v) => set('id', v.toLowerCase())}
          disabled={locked || !isNew}
          placeholder="gitea"
        />
      </div>
      <TextField
        id="m-group"
        label="Group"
        mono={false}
        value={draft.group}
        onChange={(v) => setDraft({ ...draft, group: v })}
        disabled={locked}
      />
      {kind === 'http' && (
        <>
          <TextField
            id="m-url"
            label="URL"
            value={s.url}
            onChange={(v) => set('url', v)}
            disabled={locked}
            placeholder="https://git.example.com/api/healthz"
          />
          <div className="grid grid-cols-2 gap-x-3">
            <TextField
              id="m-status"
              label="Expected status"
              value={Array.isArray(expect.status) ? (expect.status as number[]).join(', ') : ''}
              onChange={(v) =>
                set('expect', {
                  ...expect,
                  status: v ? v.split(/[ ,]+/).filter(Boolean).map(Number) : undefined,
                })
              }
              disabled={locked}
              placeholder="200-399"
            />
            <TextField
              id="m-contains"
              label="Body contains"
              value={expect.bodyContains}
              onChange={(v) => set('expect', { ...expect, bodyContains: v || undefined })}
              disabled={locked}
            />
          </div>
        </>
      )}
      {(kind === 'tcp' || kind === 'tls' || kind === 'dns' || kind === 'icmp') && (
        <div className="grid grid-cols-[1fr_110px] gap-x-3">
          <TextField
            id="m-host"
            label={kind === 'dns' ? 'Name to resolve' : 'Host'}
            value={s.host}
            onChange={(v) => set('host', v)}
            disabled={locked}
          />
          {(kind === 'tcp' || kind === 'tls') && (
            <TextField
              id="m-port"
              label="Port"
              value={s.port}
              onChange={(v) => set('port', num(v))}
              disabled={locked}
              placeholder={kind === 'tls' ? '443' : ''}
            />
          )}
          {kind === 'dns' && (
            <TextField
              id="m-record"
              label="Record"
              value={s.record ?? 'A'}
              onChange={(v) => set('record', v.toUpperCase())}
              disabled={locked}
            />
          )}
        </div>
      )}
      {kind === 'dns' && (
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            id="m-server"
            label="DNS server"
            value={s.server}
            onChange={(v) => set('server', v || undefined)}
            disabled={locked}
            placeholder="system default"
          />
          <TextField
            id="m-expect"
            label="Expected answers"
            value={Array.isArray(s.expect) ? (s.expect as string[]).join(', ') : ''}
            onChange={(v) => set('expect', v ? v.split(/[ ,]+/).filter(Boolean) : undefined)}
            disabled={locked}
          />
        </div>
      )}
      {kind === 'tls' && (
        <TextField
          id="m-mindays"
          label="Warn when certificate expires within (days)"
          value={s.minDays ?? 14}
          onChange={(v) => set('minDays', num(v))}
          disabled={locked}
        />
      )}
      {kind === 'plugin' && (
        <>
          <Field label="Plugin" htmlFor="m-plugin">
            <select
              id="m-plugin"
              className="field"
              value={String(s.plugin ?? '')}
              onChange={(e) => set('plugin', e.target.value)}
              disabled={locked}
            >
              <option value="">Choose a plugin…</option>
              {plugins.data?.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {plugin?.description && <p className="m-0 mt-1 text-[12px] text-sec">{plugin.description}</p>}
          {plugin &&
            Object.entries(plugin.args).map(([name, a]) => (
              <TextField
                key={name}
                id={`m-arg-${name}`}
                label={`${name}${a.required ? '' : ' (optional)'}`}
                hint={a.description ?? undefined}
                value={(s.args as Record<string, unknown> | undefined)?.[name]}
                onChange={(v) => {
                  const args = { ...(s.args as Record<string, unknown> | undefined) };
                  if (v === '') delete args[name];
                  else args[name] = a.type === 'number' ? Number(v) : a.type === 'boolean' ? v === 'true' : v;
                  set('args', args);
                }}
                disabled={locked}
              />
            ))}
        </>
      )}
      <div className="grid grid-cols-3 gap-x-3">
        <TextField
          id="m-interval"
          label="Interval"
          value={s.interval}
          onChange={(v) => set('interval', v)}
          disabled={locked}
        />
        <TextField
          id="m-timeout"
          label="Timeout"
          value={s.timeout}
          onChange={(v) => set('timeout', v || undefined)}
          disabled={locked}
          placeholder="10s"
        />
        <TextField
          id="m-threshold"
          label="Alert after"
          value={s.failureThreshold}
          onChange={(v) => set('failureThreshold', num(v))}
          disabled={locked}
          hint="failed checks"
        />
      </div>
      {kind !== 'plugin' && kind !== 'tls' && (
        <TextField
          id="m-degraded"
          label="Degraded when slower than"
          value={s.degradedAfter}
          onChange={(v) => set('degradedAfter', v || undefined)}
          disabled={locked}
          placeholder="e.g. 800ms"
        />
      )}
      {(notifiers.data?.length ?? 0) > 0 && (
        <div className="mt-3.5 rounded-[10px] bg-fill">
          {notifiers.data?.map((n, i) => {
            const list = (s.notify as string[] | undefined) ?? [];
            return (
              <div
                key={n.id}
                className={`flex items-center justify-between px-3 py-2 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="text-[13px]">Notify {n.id}</span>
                <Switch
                  label={`Notify ${n.id}`}
                  checked={list.includes(n.id)}
                  disabled={locked}
                  onChange={(on) => set('notify', on ? [...list, n.id] : list.filter((x) => x !== n.id))}
                />
              </div>
            );
          })}
          <p className="m-0 border-t border-hair px-3 py-2 text-[12px] text-sec">
            No channel selected means all channels.
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between rounded-[10px] bg-fill px-3 py-2">
        <span className="text-[13px]">Open an incident automatically when down</span>
        <Switch
          label="Automatic incidents"
          checked={Boolean(s.autoIncident)}
          disabled={locked}
          onChange={(v) => set('autoIncident', v)}
        />
      </div>
    </>
  );
}

function MonitorPanel({
  monitor,
  onSaved,
  onDeleted,
  isAdmin,
  isEditor,
}: {
  monitor: AdminMonitor | null;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  isAdmin: boolean;
  isEditor: boolean;
}) {
  const qc = useQueryClient();
  const isNew = monitor === null;
  const [draft, setDraft] = useState<Draft>(() => (monitor ? toDraft(monitor) : emptyDraft()));
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const locked = !isAdmin || monitor?.source === 'config';
  const refresh = () =>
    qc
      .invalidateQueries({ queryKey: ['admin', 'monitors'] })
      .then(() => qc.invalidateQueries({ queryKey: ['overview'] }));
  const onError = (e: Error) => setMessage({ tone: 'bad', text: e.message });
  const path = monitor ? `/api/v1/admin/monitors/${encodeURIComponent(monitor.id)}` : '';

  const save = useMutation({
    mutationFn: (d: Draft) =>
      isNew
        ? api<AdminMonitor>('/api/v1/admin/monitors', {
            method: 'POST',
            json: { group: d.group, spec: clean(d.spec) },
          })
        : api<AdminMonitor>(path, { method: 'PUT', json: { group: d.group, spec: clean(d.spec) } }),
    onSuccess: async (m) => {
      await refresh();
      setMessage({ tone: 'ok', text: 'Saved.' });
      onSaved(m.id);
    },
    onError,
  });
  const run = useMutation({
    mutationFn: () =>
      api<{ status: string | null; latencyMs: number | null; message: string | null }>(`${path}/run`, {
        method: 'POST',
      }),
    onSuccess: async (r) => {
      await refresh();
      setMessage({
        tone: r.status === 'up' ? 'ok' : 'bad',
        text: `${r.status ?? 'skipped'}${r.latencyMs !== null ? ` · ${ms(r.latencyMs)}` : ''}${r.message ? ` · ${r.message}` : ''}`,
      });
    },
    onError,
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => api(`${path}/pause`, { method: 'POST', json: { paused } }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api(path, { method: 'DELETE' }),
    onSuccess: async () => {
      onDeleted();
      await refresh();
    },
    onError,
  });

  return (
    <Section className="min-w-0 flex-[1_1_320px] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-semibold">{monitor?.name ?? 'New monitor'}</h2>
        {monitor && <StatusPill status={monitor.status} />}
      </div>
      {monitor && (
        <p className="m-0 mt-1 text-[12px] text-sec">
          Last check {relative(monitor.lastCheckedAt)}
          {monitor.lastMessage && ` · ${monitor.lastMessage}`}
        </p>
      )}
      {monitor?.source === 'config' && (
        <div className="mt-3">
          <Notice>
            <span className="flex gap-2">
              <Icon name="lock" size={15} className="mt-px shrink-0" />
              <span>
                Managed in <span className="font-mono text-[12px] text-text">status.yaml</span>. Edit it in
                git; changes load automatically.
              </span>
            </span>
          </Notice>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(draft);
        }}
      >
        <Editor draft={draft} setDraft={setDraft} locked={locked} isNew={isNew} />
        {message && (
          <div className="mt-3" role="status">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {monitor && isEditor && (
            <>
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={run.isPending}
                onClick={() => run.mutate()}
              >
                <Icon name="play" size={13} /> {run.isPending ? 'Checking…' : 'Run check now'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => pause.mutate(!monitor.paused)}>
                <Icon name={monitor.paused ? 'play' : 'pause'} size={13} />{' '}
                {monitor.paused ? 'Resume' : 'Pause'}
              </button>
            </>
          )}
          {!locked && (
            <button type="submit" className="btn-primary flex-1" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          )}
          {monitor?.source === 'db' && isAdmin && (
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (window.confirm(`Delete ${monitor.name} and its history?`)) remove.mutate();
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          )}
        </div>
      </form>
    </Section>
  );
}

export function MonitorsPage() {
  const monitors = useAdminMonitors();
  const me = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const isAdmin = can(me.data?.role, 'admin');
  const isEditor = can(me.data?.role, 'editor');

  if (monitors.isPending) return <Spinner />;
  if (monitors.error) return <ErrorNote error={monitors.error} />;
  const isNew = selected === '__new';
  const selectedId = isNew ? null : (selected ?? monitors.data[0]?.id ?? null);
  const current = monitors.data.find((m) => m.id === selectedId) ?? null;
  const configCount = monitors.data.filter((m) => m.source === 'config').length;

  return (
    <>
      <PageHeader
        title="Monitors"
        subtitle={`${configCount} from status.yaml · ${monitors.data.length - configCount} created here`}
        actions={
          isAdmin && (
            <button type="button" className="btn-primary" onClick={() => setSelected('__new')}>
              <Icon name="plus" size={14} /> New monitor
            </button>
          )
        }
      />
      <div className="mt-4.5 flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          <div aria-hidden="true" className="flex gap-3.5 px-4 py-2.5 text-[12px] font-medium text-sec">
            <span className="flex-1 pl-[21px]">Name</span>
            <span className="w-14">Type</span>
            <span className="w-16">Every</span>
            <span className="w-20">Source</span>
          </div>
          {monitors.data.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`row-btn ${selectedId === m.id ? 'bg-sel' : ''}`}
              aria-current={selectedId === m.id}
              onClick={() => setSelected(m.id)}
            >
              <StatusDot status={m.status} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{m.name}</span>
                <span className="block truncate font-mono text-[11px] text-sec">{m.target}</span>
              </span>
              <span className="w-14 text-[12px]">{KIND_LABEL[m.kind]}</span>
              <span className="w-16 text-[12px] text-sec">{formatDuration(m.spec.interval)}</span>
              <span className="flex w-20 items-center gap-1 text-[12px] text-sec">
                {m.source === 'config' && <Icon name="lock" size={12} />}
                {m.source === 'config' ? 'yaml' : 'UI'}
              </span>
            </button>
          ))}
        </Section>
        {(isNew || current) && (
          <MonitorPanel
            key={current?.id ?? '__new'}
            monitor={current}
            isAdmin={isAdmin}
            isEditor={isEditor}
            onSaved={setSelected}
            onDeleted={() => setSelected(null)}
          />
        )}
      </div>
    </>
  );
}
