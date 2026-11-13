import type { AdminMonitor, CatalogEntryDto, MonitorKind, MonitorSpecInput } from '@heartline/shared';
import { MONITOR_KINDS, PROVIDERS, findProvider, formatDuration } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Segmented } from '../../components/Segmented.tsx';
import { StatusDot, StatusPill } from '../../components/Status.tsx';
import { Switch } from '../../components/Switch.tsx';
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
import { api, useAdminMonitors, useCatalog, useMe, useNotifiers, usePlugins } from '../../lib/api.ts';
import { ms, relative } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

type Draft = { group: string; spec: Record<string, unknown> };

const num = (v: string) => (v === '' ? undefined : Number(v));

/** `200, 204, 300-399` → [200, 204, 300, …, 399]; invalid pieces are dropped. */
export function parseStatusList(input: string): number[] | undefined {
  const out = new Set<number>();
  for (const piece of input.split(/[ ,]+/).filter(Boolean)) {
    const range = /^(\d{3})-(\d{3})$/.exec(piece);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
    } else if (/^\d{3}$/.test(piece)) out.add(Number(piece));
  }
  return out.size ? [...out].toSorted((a, b) => a - b) : undefined;
}

/** Collapses consecutive codes back into ranges for display. */
export function formatStatusList(codes: number[]): string {
  const sorted = [...codes].toSorted((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] as number) + 1) j++;
    parts.push(j > i + 1 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

type VersionMode = 'auto' | 'json' | 'header' | 'regex' | 'static';

function versionMode(v: Record<string, unknown> | undefined): VersionMode {
  if (!v) return 'auto';
  if (v.static !== undefined) return 'static';
  if (v.json !== undefined) return 'json';
  if (v.header !== undefined) return 'header';
  if (v.regex !== undefined) return 'regex';
  return 'auto';
}

type ReleaseMode = 'auto' | 'gitea' | 'github' | 'url';

function ReleasesFields({
  sw,
  setSw,
  locked,
  entry,
}: {
  sw: Record<string, unknown> | undefined;
  setSw: (patch: Record<string, unknown> | undefined) => void;
  locked: boolean;
  entry: CatalogEntryDto | undefined;
}) {
  const rel = (sw?.releases as Record<string, unknown> | undefined) ?? undefined;
  const mode: ReleaseMode =
    rel?.gitea !== undefined
      ? 'gitea'
      : rel?.github !== undefined
        ? 'github'
        : rel?.url !== undefined
          ? 'url'
          : 'auto';
  const setRel = (patch: Record<string, unknown> | undefined) => setSw({ ...sw, releases: patch });
  const autoLabel = entry?.endoflife ? 'endoflife.date' : entry?.github ? 'GitHub (catalog)' : 'None';
  return (
    <>
      <div className="mt-3">
        <div className="label">Latest release from</div>
        <Segmented
          size="sm"
          label="Latest release from"
          value={mode}
          onChange={(m) =>
            setRel(
              m === 'auto'
                ? undefined
                : m === 'gitea'
                  ? { gitea: '', repo: '' }
                  : m === 'github'
                    ? { github: '' }
                    : { url: '', json: '' },
            )
          }
          options={[
            { value: 'auto', label: autoLabel },
            { value: 'gitea', label: 'Gitea / Forgejo' },
            { value: 'github', label: 'GitHub' },
            { value: 'url', label: 'URL' },
          ]}
        />
      </div>
      {mode === 'gitea' && (
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            id="m-rel-gitea"
            label="Instance URL"
            value={rel?.gitea}
            onChange={(v) => setRel({ ...rel, gitea: v })}
            disabled={locked}
            placeholder="https://git.example.com"
          />
          <TextField
            id="m-rel-repo"
            label="Repository"
            value={rel?.repo}
            onChange={(v) => setRel({ ...rel, repo: v })}
            disabled={locked}
            placeholder="owner/name"
          />
        </div>
      )}
      {mode === 'github' && (
        <TextField
          id="m-rel-github"
          label="GitHub repository"
          value={rel?.github}
          onChange={(v) => setRel({ ...rel, github: v })}
          disabled={locked}
          placeholder="owner/name"
        />
      )}
      {mode === 'url' && (
        <div className="grid grid-cols-2 gap-x-3">
          <TextField
            id="m-rel-url"
            label="URL"
            value={rel?.url}
            onChange={(v) => setRel({ ...rel, url: v })}
            disabled={locked}
            placeholder="https://…/latest.json"
          />
          <TextField
            id="m-rel-json"
            label="JSON path or regex"
            value={rel?.regex !== undefined ? `/${rel.regex}/` : rel?.json}
            onChange={(v) => {
              const m = /^\/(.+)\/$/.exec(v);
              const { json: _j, regex: _r, ...rest } = rel ?? {};
              setRel(m ? { ...rest, regex: m[1] } : { ...rest, json: v });
            }}
            disabled={locked}
            placeholder="tag_name  or  /v(\\d+\\.\\d+\\.\\d+)/"
          />
        </div>
      )}
      {mode !== 'auto' && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-base">Count pre-releases</span>
          <Switch
            label="Count pre-releases"
            checked={rel?.prerelease === true}
            disabled={locked}
            onChange={(on) => setRel({ ...rel, prerelease: on ? true : undefined })}
          />
        </div>
      )}
    </>
  );
}

function SoftwareFields({
  spec,
  set,
  locked,
  kind,
}: {
  spec: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  locked: boolean;
  kind: MonitorKind;
}) {
  const catalog = useCatalog();
  const sw = (spec.software as Record<string, unknown> | undefined) ?? undefined;
  const version = (sw?.version as Record<string, unknown> | undefined) ?? undefined;
  const enabled = sw !== undefined;
  const entry = catalog.data?.find((c) => c.slug === sw?.product);
  const mode = versionMode(version);
  const setSw = (patch: Record<string, unknown> | undefined) => set('software', patch);
  const setVersion = (patch: Record<string, unknown> | undefined) =>
    setSw({ ...sw, version: patch && Object.keys(patch).length ? patch : undefined });
  const switchMode = (m: VersionMode) => {
    const keep = { url: version?.url, headers: version?.headers, interval: version?.interval };
    const base = Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined));
    setVersion(
      m === 'auto'
        ? Object.keys(base).length
          ? base
          : undefined
        : { ...base, [m]: m === 'json' ? 'version' : '' },
    );
  };
  const needsUrl = kind !== 'http' && kind !== 'plugin';
  return (
    <div className="mt-4 rounded-md bg-fill">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-base">Track version and vulnerabilities</span>
        <Switch
          label="Track software"
          checked={enabled}
          disabled={locked}
          onChange={(on) => setSw(on ? { product: entry?.slug ?? '' } : undefined)}
        />
      </div>
      {enabled && (
        <div className="border-t border-hair px-3 pb-3">
          <Field
            label="Product"
            htmlFor="m-product"
            hint="Catalog products come with a version probe, CPE and OSV package."
          >
            <div className="flex gap-2">
              <select
                id="m-product-select"
                aria-label="Catalog product"
                className="field w-44"
                value={entry ? entry.slug : 'custom'}
                disabled={locked}
                onChange={(e) => setSw({ ...sw, product: e.target.value === 'custom' ? '' : e.target.value })}
              >
                <option value="custom">Custom…</option>
                {catalog.data?.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                id="m-product"
                className="field font-mono text-base"
                value={String(sw?.product ?? '')}
                disabled={locked}
                placeholder="slug, e.g. gitea"
                onChange={(e) => setSw({ ...sw, product: e.target.value.toLowerCase() })}
              />
            </div>
          </Field>
          {entry?.probe?.note && <p className="m-0 mt-1 text-xs text-sec">{entry.probe.note}</p>}
          <div className="mt-3">
            <div className="label">Version source</div>
            <Segmented
              size="sm"
              label="Version source"
              value={mode}
              onChange={switchMode}
              options={[
                { value: 'auto', label: kind === 'plugin' ? 'Plugin' : entry?.probe ? 'Catalog' : 'None' },
                { value: 'json', label: 'JSON' },
                { value: 'header', label: 'Header' },
                { value: 'regex', label: 'Regex' },
                { value: 'static', label: 'Fixed' },
              ]}
            />
          </div>
          {mode === 'static' ? (
            <TextField
              id="m-ver-static"
              label="Version"
              value={version?.static}
              onChange={(v) => setVersion({ ...version, static: v })}
              disabled={locked}
              placeholder="16.2"
            />
          ) : (
            <>
              {mode !== 'auto' && (
                <TextField
                  id={`m-ver-${mode}`}
                  label={
                    mode === 'json' ? 'JSON path' : mode === 'header' ? 'Header name' : 'Regular expression'
                  }
                  value={version?.[mode]}
                  onChange={(v) => setVersion({ ...version, [mode]: v })}
                  disabled={locked}
                  placeholder={
                    mode === 'json'
                      ? 'data.version'
                      : mode === 'header'
                        ? 'x-gitea-version'
                        : 'v?(\\d+\\.\\d+\\.\\d+)'
                  }
                  hint={mode === 'regex' ? 'Capture groups are joined with dots.' : undefined}
                />
              )}
              {(mode !== 'auto' || needsUrl || entry?.probe) && (
                <TextField
                  id="m-ver-url"
                  label={needsUrl ? 'Version URL' : 'Version URL (optional)'}
                  value={version?.url}
                  onChange={(v) => setVersion({ ...version, url: v || undefined })}
                  disabled={locked}
                  placeholder={
                    entry?.probe && kind === 'http'
                      ? `catalog default: ${entry.probe.path}`
                      : kind === 'http'
                        ? 'defaults to the check URL'
                        : 'https://…'
                  }
                />
              )}
            </>
          )}
          <ReleasesFields sw={sw} setSw={setSw} locked={locked} entry={entry} />
          <TextField
            id="m-pin-cycle"
            label="Stay on release cycle (optional)"
            value={sw?.pinCycle}
            onChange={(v) => setSw({ ...sw, pinCycle: v || undefined })}
            disabled={locked}
            placeholder="e.g. 1.24"
            hint="Newer cycles are then not counted as updates."
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-base">Look up vulnerabilities</span>
            <Switch
              label="Look up vulnerabilities"
              checked={sw?.track !== false}
              disabled={locked}
              onChange={(on) => setSw({ ...sw, track: on ? undefined : false })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<MonitorKind, string> = {
  http: 'HTTP',
  tcp: 'TCP',
  dns: 'DNS',
  tls: 'TLS',
  icmp: 'Ping',
  plugin: 'Plugin',
  provider: 'Provider',
};

const COMPONENT_LABEL = { components: 'Components', products: 'Products', services: 'Services' } as const;

const splitList = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function emptyDraft(kind: MonitorKind = 'http'): Draft {
  if (kind === 'provider')
    return {
      group: 'Third-party',
      spec: {
        id: '',
        name: '',
        type: kind,
        provider: 'github',
        interval: '5m',
        failureThreshold: 1,
        notify: [],
      },
    };
  return {
    group: 'Services',
    spec: { id: '', name: '', type: kind, interval: '60s', failureThreshold: 2, notify: [] },
  };
}

/** Provider preset, status URL, component filter and Microsoft 365 credentials. */
function ProviderFields({
  s,
  set,
  locked,
}: {
  s: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  locked: boolean;
}) {
  const preset = findProvider(String(s.provider ?? ''));
  const m365 = (s.m365 ?? {}) as Record<string, unknown>;
  return (
    <>
      <Field label="Provider" htmlFor="m-provider">
        <select
          id="m-provider"
          className="field"
          value={String(s.provider ?? '')}
          onChange={(e) => set('provider', e.target.value)}
          disabled={locked}
        >
          {PROVIDERS.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {preset?.kind !== 'm365' && (
        <TextField
          id="m-provider-url"
          label={
            preset?.url ? 'Status URL (optional)' : preset?.kind === 'feed' ? 'Feed URL' : 'Status page URL'
          }
          value={s.url}
          onChange={(v) => set('url', v || undefined)}
          disabled={locked}
          placeholder={
            preset?.url ??
            (preset?.kind === 'feed' ? 'https://status.example.com/feed.rss' : 'https://status.example.com')
          }
        />
      )}
      {preset?.kind === 'm365' && (
        <>
          <div className="grid grid-cols-2 gap-x-3">
            <TextField
              id="m-tenant"
              label="Tenant ID"
              value={m365.tenantId}
              onChange={(v) => set('m365', { ...m365, tenantId: v })}
              disabled={locked}
            />
            <TextField
              id="m-client"
              label="Client ID"
              value={m365.clientId}
              onChange={(v) => set('m365', { ...m365, clientId: v })}
              disabled={locked}
            />
          </div>
          <Field label="Client secret" htmlFor="m-secret" hint="App registration with ServiceHealth.Read.All">
            <input
              id="m-secret"
              type="password"
              autoComplete="off"
              className="field font-mono text-base"
              value={String(m365.clientSecret ?? '')}
              onChange={(e) => set('m365', { ...m365, clientSecret: e.target.value })}
              disabled={locked}
            />
          </Field>
        </>
      )}
      <TextField
        id="m-components"
        label={`${preset?.components ? COMPONENT_LABEL[preset.components] : 'Title keywords'} (optional)`}
        value={Array.isArray(s.components) ? (s.components as string[]).join(', ') : ''}
        onChange={(v) => set('components', splitList(v))}
        disabled={locked}
        mono={false}
        hint="Comma separated; empty means everything"
        placeholder={preset?.kind === 'm365' ? 'Exchange Online, Microsoft Teams' : ''}
      />
    </>
  );
}

function toDraft(m: AdminMonitor): Draft {
  const spec: Record<string, unknown> = {
    ...m.spec,
    interval: formatDuration(m.spec.interval),
    timeout: formatDuration(m.spec.timeout),
  };
  if ('degradedAfter' in m.spec && m.spec.degradedAfter !== undefined)
    spec.degradedAfter = formatDuration(m.spec.degradedAfter);
  if (m.spec.software?.version) {
    const { interval, headers, method, ignoreTls, ...rest } = m.spec.software.version;
    const version: Record<string, unknown> = { ...rest };
    if (interval !== 3_600_000) version.interval = formatDuration(interval);
    if (Object.keys(headers).length) version.headers = headers;
    if (method !== 'GET') version.method = method;
    if (ignoreTls) version.ignoreTls = true;
    spec.software = { ...m.spec.software, version };
  }
  return { group: m.group, spec };
}

/** Removes empty optional strings (recursively) so the server applies its defaults. */
function clean(spec: Record<string, unknown>): MonitorSpecInput {
  const strip = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === '' || v === undefined) continue;
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? strip(v as Record<string, unknown>) : v;
    }
    return out;
  };
  const out = strip(spec);
  const sw = out.software as Record<string, unknown> | undefined;
  if (sw?.version && Object.keys(sw.version as object).length === 0) delete sw.version;
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
        className={`field ${mono ? 'font-mono text-base' : ''}`}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </Field>
  );
}

/** Keeps the raw text while typing so ranges like `200-399` can be entered. */
function StatusField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(value);
  return (
    <TextField
      id="m-status"
      label="Expected status"
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(v);
      }}
      disabled={disabled}
      placeholder="200-399 (default 2xx and 3xx)"
      hint="Codes or ranges, comma separated"
    />
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
            columns={4}
            value={kind}
            onChange={(k) =>
              setDraft({
                // Keep a group the user typed; otherwise use the default group of the new type.
                group: draft.group === emptyDraft(kind).group ? emptyDraft(k).group : draft.group,
                spec: { ...emptyDraft(k).spec, id: s.id, name: s.name },
              })
            }
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
            <StatusField
              value={Array.isArray(expect.status) ? formatStatusList(expect.status as number[]) : ''}
              onChange={(v) => set('expect', { ...expect, status: parseStatusList(v) })}
              disabled={locked}
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
      {kind === 'provider' && <ProviderFields s={s} set={set} locked={locked} />}
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
          {plugin?.description && <p className="m-0 mt-1 text-xs text-sec">{plugin.description}</p>}
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
      {kind !== 'plugin' && kind !== 'tls' && kind !== 'provider' && (
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
        <div className="mt-4 rounded-md bg-fill">
          {notifiers.data?.map((n, i) => {
            const list = (s.notify as string[] | undefined) ?? [];
            return (
              <div
                key={n.id}
                className={`flex items-center justify-between px-3 py-2 ${i ? 'border-t border-hair' : ''}`}
              >
                <span className="text-base">Notify {n.id}</span>
                <Switch
                  label={`Notify ${n.id}`}
                  checked={list.includes(n.id)}
                  disabled={locked}
                  onChange={(on) => set('notify', on ? [...list, n.id] : list.filter((x) => x !== n.id))}
                />
              </div>
            );
          })}
          <p className="m-0 border-t border-hair px-3 py-2 text-xs text-sec">
            No channel selected means all channels.
          </p>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between rounded-md bg-fill px-3 py-2">
        <span className="text-base">Open an incident automatically when down</span>
        <Switch
          label="Automatic incidents"
          checked={Boolean(s.autoIncident)}
          disabled={locked}
          onChange={(v) => set('autoIncident', v)}
        />
      </div>
      <TextField
        id="m-depends"
        label="Depends on (optional)"
        value={Array.isArray(s.dependsOn) ? (s.dependsOn as string[]).join(', ') : ''}
        onChange={(v) => set('dependsOn', splitList(v))}
        disabled={locked}
        hint="Service IDs; their outages are shown as a likely cause"
        placeholder="github, atlassian-jira"
      />
      {kind !== 'provider' && <SoftwareFields spec={s} set={set} locked={locked} kind={kind} />}
    </>
  );
}

/** Request paths of the monitor form, mapped to the inputs that show them. */
const MONITOR_FIELDS: Record<string, string> = {
  group: 'm-group',
  'spec.name': 'm-name',
  'spec.id': 'm-id',
  'spec.url': 'm-url',
  'spec.expect.status': 'm-status',
  'spec.expect.bodyContains': 'm-contains',
  'spec.expect': 'm-expect',
  'spec.host': 'm-host',
  'spec.port': 'm-port',
  'spec.record': 'm-record',
  'spec.server': 'm-server',
  'spec.minDays': 'm-mindays',
  'spec.plugin': 'm-plugin',
  'spec.provider': 'm-provider',
  'spec.interval': 'm-interval',
  'spec.timeout': 'm-timeout',
  'spec.failureThreshold': 'm-threshold',
  'spec.degradedAfter': 'm-degraded',
  'spec.dependsOn': 'm-depends',
};

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
      setMessage(null);
      toast(isNew ? `Created ${m.name}` : `Saved ${m.name}`);
      onSaved(m.id);
    },
    onMutate: () => setMessage(null),
  });
  const saveErrors = fieldErrorsOf(save.error, MONITOR_FIELDS);
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
    onSuccess: async (_r, paused) => {
      await refresh();
      toast(paused ? `Paused ${monitor?.name}` : `Resumed ${monitor?.name}`);
    },
    meta: { errorToast: true },
  });
  const remove = useMutation({
    mutationFn: () => api(path, { method: 'DELETE' }),
    onSuccess: async () => {
      onDeleted();
      toast(`Deleted ${monitor?.name}`);
      await refresh();
    },
    meta: { errorToast: true },
  });
  const confirm = useConfirm();

  return (
    <Section className="min-w-0 flex-[1_1_320px] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-medium">{monitor?.name ?? 'New monitor'}</h2>
        {monitor && <StatusPill status={monitor.status} />}
      </div>
      {monitor && (
        <p className="m-0 mt-1 text-xs text-sec">
          Last check {relative(monitor.lastCheckedAt)}
          {monitor.lastMessage && ` · ${monitor.lastMessage}`}
        </p>
      )}
      {monitor?.source === 'config' && (
        <div className="mt-3">
          <Notice>
            <span className="flex gap-2">
              <Icon name="lock" size={16} className="mt-px shrink-0" />
              <span>
                Managed in <span className="font-mono text-xs text-text">status.yaml</span>. Edit it in git;
                changes load automatically.
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
        <FieldErrors errors={saveErrors.byId}>
          <Editor draft={draft} setDraft={setDraft} locked={locked} isNew={isNew} />
        </FieldErrors>
        {saveErrors.rest.length > 0 && (
          <div className="mt-3" role="alert">
            <Notice tone="bad">{saveErrors.rest.join(' · ')}</Notice>
          </div>
        )}
        {save.error && saveErrors.rest.length === 0 && (
          <div className="mt-3" role="alert">
            <Notice tone="bad">Check the highlighted fields.</Notice>
          </div>
        )}
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
                className="btn flex-1"
                disabled={run.isPending}
                onClick={() => run.mutate()}
              >
                <Icon name="play" size={16} /> {run.isPending ? 'Checking…' : 'Run check now'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={pause.isPending}
                onClick={() => pause.mutate(!monitor.paused)}
              >
                <Icon name={monitor.paused ? 'play' : 'pause'} size={16} />{' '}
                {pause.isPending
                  ? monitor.paused
                    ? 'Resuming…'
                    : 'Pausing…'
                  : monitor.paused
                    ? 'Resume'
                    : 'Pause'}
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
              disabled={remove.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Delete ${monitor.name}?`,
                    message: 'Its check history and uptime are deleted as well. This cannot be undone.',
                    confirm: 'Delete monitor',
                  })
                )
                  remove.mutate();
              }}
            >
              <Icon name="trash" size={16} /> Delete
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
              <Icon name="plus" size={16} /> New monitor
            </button>
          )
        }
      />
      <div className="flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[999_1_420px]">
          {monitors.data.length === 0 ? (
            <EmptyState title="No monitors yet">
              {isAdmin
                ? 'Create one with “New monitor”, or add monitors to status.yaml.'
                : 'Monitors are added in status.yaml or by an admin.'}
            </EmptyState>
          ) : (
            <div aria-hidden="true" className="flex gap-4 px-4 py-2 text-xs font-medium text-sec">
              <span className="flex-1 pl-6">Name</span>
              <span className="w-14 max-sm:hidden">Type</span>
              <span className="w-16 max-sm:hidden">Every</span>
              <span className="w-20 max-sm:hidden">Source</span>
            </div>
          )}
          {monitors.data.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`row-btn ${selectedId === m.id ? 'bg-sel' : ''}`}
              aria-current={selectedId === m.id ? 'true' : undefined}
              onClick={() => setSelected(m.id)}
            >
              <StatusDot status={m.status} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{m.name}</span>
                <span className="block truncate font-mono text-xs text-muted">{m.target}</span>
              </span>
              <span className="w-14 text-xs max-sm:hidden">{KIND_LABEL[m.kind]}</span>
              <span className="w-16 text-xs text-sec max-sm:hidden">{formatDuration(m.spec.interval)}</span>
              <span className="flex w-20 items-center gap-1 text-xs text-sec max-sm:hidden">
                {m.source === 'config' && <Icon name="lock" size={16} />}
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
