import type { SoftwareDetail, SoftwareInventory, UrgencyLevel } from '@heartline/shared';
import { URGENCY_LEVELS } from '@heartline/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Segmented } from '../../components/Segmented.tsx';
import { UrgencyBadge, VulnCounts, VulnTable } from '../../components/Urgency.tsx';
import { Empty, ErrorNote, Notice, PageHeader, Section, Spinner, Stats } from '../../components/ui.tsx';
import { api, useMe, useServiceSoftware, useSoftwareInventory } from '../../lib/api.ts';
import { URGENCY_LABEL, relative, shortDate } from '../../lib/format.ts';
import { can } from '../../lib/roles.ts';

type Row = SoftwareInventory['services'][number];
type Filter = 'all' | 'attention' | UrgencyLevel;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'unknown', label: 'Unknown' },
];

function Expanded({
  row,
  canWrite,
  onRefreshed,
}: {
  row: Row;
  canWrite: boolean;
  onRefreshed: () => Promise<void>;
}) {
  const detail = useServiceSoftware(row.serviceId, true);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () =>
      api<SoftwareDetail>(`/api/v1/admin/monitors/${encodeURIComponent(row.serviceId)}/software/refresh`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      setMessage('Refreshed.');
      await detail.refetch();
      await onRefreshed();
    },
    onError: (e: Error) => setMessage(e.message),
  });
  const d = detail.data;
  return (
    <div className="border-t border-hair bg-side">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3 text-[13px]">
        <div className="min-w-0 flex-1">
          {row.reasons.length > 0 ? (
            <ul className="m-0 list-disc pl-5">
              {row.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <span className="text-sec">
              {row.version ? 'Nothing to do' : 'The version has not been detected yet'}
            </span>
          )}
          {row.probeError && <p className="m-0 mt-1 text-[12px] text-warn-text">Probe: {row.probeError}</p>}
          {row.intelError && <p className="m-0 mt-1 text-[12px] text-warn-text">Sources: {row.intelError}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 text-[12px] text-muted">
          <span>
            version via {row.versionSource ?? '–'}
            {row.previousVersion && ` · was ${row.previousVersion} ${relative(row.versionChangedAt)}`}
          </span>
          <span>
            {row.intelRefreshedAt ? `data refreshed ${relative(row.intelRefreshedAt)}` : 'not refreshed yet'}
          </span>
          <span className="flex gap-2">
            <Link to="/services/$id" params={{ id: row.serviceId }} className="btn-sm no-underline">
              <Icon name="external" size={16} /> Status page
            </Link>
            {row.releasesUrl && (
              <a href={row.releasesUrl} target="_blank" rel="noreferrer" className="btn-sm no-underline">
                Release notes
              </a>
            )}
            {canWrite && (
              <button
                type="button"
                className="btn-sm"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <Icon name="refresh" size={16} /> {refresh.isPending ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </span>
          {message && (
            <span role="status" className="text-[12px]">
              {message}
            </span>
          )}
        </div>
      </div>
      {detail.isPending && <Spinner label="Loading vulnerabilities…" />}
      {d && <VulnTable vulns={d.vulnerabilities} />}
    </div>
  );
}

export function SoftwarePage() {
  const inventory = useSoftwareInventory();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { service } = useSearch({ strict: false }) as { service?: string };
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(service ?? null);
  const canWrite = can(me.data?.role, 'editor');
  const refreshAll = useMutation({
    mutationFn: () => api<{ queued: boolean }>('/api/v1/admin/software/refresh', { method: 'POST' }),
    onSuccess: () => {
      // The refresh runs in the background; poll the inventory for a short while.
      let n = 0;
      const t = setInterval(() => {
        void qc.invalidateQueries({ queryKey: ['software'] });
        if (++n >= 6) clearInterval(t);
      }, 5_000);
    },
  });
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['software'] });
    await qc.invalidateQueries({ queryKey: ['overview'] });
  };

  if (inventory.isPending) return <Spinner />;
  if (inventory.error) return <ErrorNote error={inventory.error} />;
  const inv = inventory.data;
  const rows = inv.services.filter((s) => {
    const u = s.urgency ?? 'unknown';
    if (filter === 'all') return true;
    if (filter === 'attention') return u === 'critical' || u === 'high' || u === 'medium';
    return u === filter;
  });
  const attention = inv.totals.critical + inv.totals.high + inv.totals.medium;

  return (
    <>
      <PageHeader
        title="Software"
        subtitle={
          <>
            {inv.services.length} tracked service{inv.services.length === 1 ? '' : 's'} ·{' '}
            {inv.lastRefreshAt ? `data refreshed ${relative(inv.lastRefreshAt)}` : 'no refresh yet'} ·
            sources: OSV, NVD, endoflife.date, CISA KEV
          </>
        }
        actions={
          canWrite && (
            <button
              type="button"
              className="btn"
              disabled={refreshAll.isPending}
              onClick={() => refreshAll.mutate()}
            >
              <Icon name="refresh" size={16} /> Refresh all
            </button>
          )
        }
      />
      {refreshAll.isSuccess && (
        <div role="status">
          <Notice tone="ok">Refresh started; results appear as the sources answer.</Notice>
        </div>
      )}
      <div>
        <Stats
          items={[
            { label: 'Update now', value: inv.totals.critical, hint: 'critical' },
            { label: 'Update soon', value: inv.totals.high, hint: 'high' },
            { label: 'Advised', value: inv.totals.medium, hint: 'medium' },
            { label: 'Up to date', value: inv.totals.none + inv.totals.low, hint: 'none or minor' },
            { label: 'Unknown', value: inv.totals.unknown, hint: 'no version or no data' },
          ]}
        />
      </div>
      <div>
        <Segmented
          size="sm"
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f.value,
            label: f.value === 'attention' ? `${f.label} (${attention})` : f.label,
          }))}
        />
      </div>
      <Section>
        <div aria-hidden="true" className="flex gap-4 px-4 py-2 text-[12px] font-medium text-muted">
          <span className="flex-1 pl-[21px]">Service</span>
          <span className="w-28">Running</span>
          <span className="w-28">Latest</span>
          <span className="w-32">Cycle</span>
          <span className="w-36">Urgency</span>
          <span className="w-40">Vulnerabilities</span>
        </div>
        {inv.services.length === 0 && (
          <Empty>
            No service tracks its software yet. Add a <span className="font-mono text-[12px]">software</span>{' '}
            block to a monitor, e.g.{' '}
            <span className="font-mono text-[12px]">
              software: {'{'} product: gitea {'}'}
            </span>
            .
          </Empty>
        )}
        {inv.services.length > 0 && rows.length === 0 && <Empty>Nothing matches this filter</Empty>}
        {rows.map((s) => {
          const level = s.urgency ?? 'unknown';
          const isOpen = open === s.serviceId;
          return (
            <div key={s.serviceId}>
              <button
                type="button"
                className={`row-btn ${isOpen ? 'bg-sel' : ''}`}
                aria-expanded={isOpen}
                onClick={() => {
                  setOpen(isOpen ? null : s.serviceId);
                  void navigate({ to: '/admin/software', search: isOpen ? {} : { service: s.serviceId } });
                }}
              >
                <Icon
                  name="chevron"
                  size={16}
                  className={`shrink-0 text-sec transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.serviceName}</span>
                  <span className="block text-[12px] text-muted">
                    {s.productName} · {s.group}
                  </span>
                </span>
                <span className="w-28 font-mono text-[12px]">
                  {s.version ?? <span className="text-sec">–</span>}
                </span>
                <span className="w-28 font-mono text-[12px]">
                  {s.latest ? (
                    s.latestUrl ? (
                      <a
                        href={s.latestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-text"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.latest}
                      </a>
                    ) : (
                      s.latest
                    )
                  ) : (
                    <span className="text-sec">–</span>
                  )}
                  {s.latestInCycle && s.latestInCycle !== s.latest && (
                    <span className="block text-[12px] text-muted">{s.latestInCycle} in cycle</span>
                  )}
                </span>
                <span className="w-32 text-[12px]">
                  {s.cycle ?? s.pinnedCycle ?? <span className="text-sec">–</span>}
                  {s.pinnedCycle && <span className="block text-[12px] text-muted">pinned</span>}
                  {s.eolReached ? (
                    <span className="block text-[12px] text-bad-text">end-of-life</span>
                  ) : s.eol ? (
                    <span className="block text-[12px] text-muted">until {shortDate(s.eol)}</span>
                  ) : null}
                </span>
                <span className="w-36">
                  <UrgencyBadge level={level} score={s.score} />
                </span>
                <span className="w-40 text-[12px]">
                  <VulnCounts vulns={s.vulns} />
                </span>
              </button>
              {isOpen && <Expanded row={s} canWrite={canWrite} onRefreshed={invalidate} />}
            </div>
          );
        })}
      </Section>
      <p className="m-0 text-[12px] text-muted">
        Urgency: {URGENCY_LEVELS.map((l) => `${l} = ${URGENCY_LABEL[l].toLowerCase()}`).join(', ')}. Scores
        combine CVSS, exploitation (CISA KEV), end-of-life and how far behind the latest release a service is.{' '}
        <a href="/api/v1/software/report.csv" className="text-sec hover:text-text">
          Export CSV
        </a>
      </p>
    </>
  );
}
