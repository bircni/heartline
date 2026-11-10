import type { Incident, Maintenance } from '@heartline/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DayBars, DayLegend, TraceAxis } from '../components/DayBars.tsx';
import { Icon } from '../components/Icon.tsx';
import { Pulse, StatusDot } from '../components/Status.tsx';
import { UrgencyBadge } from '../components/Urgency.tsx';
import { ErrorNote, Section, Spinner } from '../components/ui.tsx';
import { useOverview } from '../lib/api.ts';
import { STATUS_LABEL, STATUS_TONE, dayTicks, pct, relative } from '../lib/format.ts';
import { RangeControl, useRange } from './RangeControl.tsx';

/** A notice above the services. The bar on its left edge carries the severity. */
const ALERT =
  'card relative flex gap-3 overflow-hidden py-3 pl-5 pr-4 text-text no-underline transition-colors hover:bg-hover before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-(--tone)';

function IncidentAlert({ incident: i }: { incident: Incident }) {
  const major = i.impact === 'major';
  return (
    <Link
      to="/incidents/$id"
      params={{ id: i.id }}
      className={ALERT}
      style={{ '--tone': major ? 'var(--bad)' : 'var(--warn)' } as React.CSSProperties}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[15px] font-semibold">{i.title}</span>
          <span
            className="text-[12px] font-medium first-letter:uppercase"
            style={{ color: major ? 'var(--bad-text)' : 'var(--warn-text)' }}
          >
            {i.status}
          </span>
        </div>
        <div className="line-clamp-2 max-w-[80ch] text-sec">{i.updates[0]?.message}</div>
        <div className="mt-1 text-[12px] text-muted">
          {i.services.map((s) => s.name).join(', ') || 'All services'}, updated{' '}
          {relative(i.updates[0]?.createdAt ?? i.createdAt)}
        </div>
      </div>
      <Icon name="chevron" size={16} className="mt-1 shrink-0 text-muted" />
    </Link>
  );
}

const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function MaintenanceRow({ window: m }: { window: Maintenance }) {
  const start = m.nextStartsAt ?? m.startsAt;
  const end = m.nextEndsAt ?? m.endsAt;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 border-t border-hair px-4 py-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_auto]">
      <span className="font-medium max-md:col-span-2">{m.title}</span>
      <span className="min-w-0 truncate text-[13px] text-sec">
        {m.services.map((s) => s.name).join(', ') || 'All services'}
      </span>
      <span className="whitespace-nowrap text-right text-[13px] text-sec">
        {m.active ? (
          <span className="font-medium text-maint">In progress until {clock.format(end)}</span>
        ) : (
          `${day.format(start)}, ${clock.format(start)} – ${clock.format(end)}`
        )}
      </span>
    </div>
  );
}

export function OverviewPage() {
  const days = useRange();
  const { data, error, isPending } = useOverview(days);
  const [q, setQ] = useState('');
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const filter = q.trim().toLowerCase();
  const groups = data.groups
    .map((g) => ({
      ...g,
      services: g.services.filter((s) => !filter || s.name.toLowerCase().includes(filter)),
    }))
    .filter((g) => g.services.length > 0);
  // Every service covers the same days, so one axis serves all rows.
  const ticks = dayTicks(data.groups[0]?.services[0]?.bars.map((b) => b.day) ?? []);
  const urgent = data.security ? data.security.critical + data.security.high : 0;

  return (
    <>
      <header className="pt-2 md:pt-4">
        <h1 className="display m-0">{data.headline}</h1>
        <p className="m-0 mt-2 text-[15px] text-sec">
          {data.summary}{' '}
          <span className="whitespace-nowrap text-muted">Checked {relative(data.generatedAt)}.</span>
        </p>
        <div className="mt-3 md:mt-4">
          <Pulse status={data.status} />
        </div>
      </header>

      {(data.activeIncidents.length > 0 || urgent > 0) && (
        <div className="mt-4 flex flex-col gap-2">
          {data.activeIncidents.map((i) => (
            <IncidentAlert key={i.id} incident={i} />
          ))}
          {urgent > 0 && data.security && (
            <Link
              to="/admin/software"
              className={`${ALERT} items-center`}
              style={{ '--tone': 'var(--bad)' } as React.CSSProperties}
            >
              <Icon name="shield" size={16} className="shrink-0 text-bad-text" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {urgent} service{urgent === 1 ? ' needs' : 's need'} an urgent update
                </span>{' '}
                <span className="text-sec">
                  ({data.security.critical} critical, {data.security.high} high)
                </span>
              </span>
              <Icon name="chevron" size={16} className="shrink-0 text-muted" />
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[16px] font-semibold">Uptime, past {days} days</h2>
        <div className="flex flex-wrap items-center gap-2">
          {data.total > 5 && (
            <>
              <label htmlFor="svc-filter" className="sr-only">
                Filter services
              </label>
              <div className="flex h-8 w-44 items-center gap-2 rounded-[6px] bg-fill px-2.5 shadow-[inset_0_0_0_1px_var(--hair)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus)">
                <Icon name="search" size={14} className="shrink-0 text-muted" />
                <input
                  id="svc-filter"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter services"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text outline-none"
                />
              </div>
            </>
          )}
          <RangeControl />
        </div>
      </div>

      {data.groups.length === 0 ? (
        <p className="card m-0 mt-3 px-4 py-6 text-sec">
          No services yet. Add monitors to status.yaml or in the admin area.
        </p>
      ) : (
        <section aria-label="Services" className="card mt-3 overflow-hidden">
          <div className="lead-grid py-2.5 text-[12px] text-muted">
            <span className="max-md:hidden">Service</span>
            <TraceAxis ticks={ticks} className="lead-trace" />
            <span className="text-right max-md:hidden">Uptime</span>
          </div>
          {groups.length === 0 && (
            <p className="m-0 border-t border-hair px-4 py-6 text-sec">No service matches “{q.trim()}”.</p>
          )}
          {groups.map((g) => (
            <div key={g.name} className="border-t border-hair pb-1.5">
              <h3 className="m-0 px-4 pb-1 pt-3.5 text-[12px] font-medium text-muted">{g.name}</h3>
              {g.services.map((s) => (
                <Link
                  key={s.id}
                  to="/services/$id"
                  params={{ id: s.id }}
                  search={{ days }}
                  className="lead-grid py-2.5 text-text no-underline transition-colors hover:bg-hover"
                  aria-label={`${s.name}: ${s.status}, ${pct(s.uptime)} uptime. Open details.`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <StatusDot status={s.status} />
                    <span className="truncate font-medium">{s.name}</span>
                    {s.status !== 'operational' && (
                      <span
                        className="shrink-0 text-[12px] font-medium"
                        style={{ color: STATUS_TONE[s.status].text }}
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                    )}
                    {s.software?.version && (
                      <span className="shrink-0 text-[12px] text-muted max-lg:hidden">
                        v{s.software.version}
                      </span>
                    )}
                    {s.software?.urgency &&
                      s.software.urgency !== 'none' &&
                      s.software.urgency !== 'unknown' && (
                        <UrgencyBadge level={s.software.urgency} score={s.software.score} />
                      )}
                  </span>
                  <span className="lead-trace">
                    <DayBars bars={s.bars} ticks={ticks} />
                  </span>
                  <span className="figure text-right text-[14px] text-sec" aria-hidden="true">
                    {pct(s.uptime)}
                  </span>
                </Link>
              ))}
            </div>
          ))}
          <div className="border-t border-hair px-4 py-2.5">
            <DayLegend />
          </div>
        </section>
      )}

      {data.upcomingMaintenance.length > 0 && (
        <Section className="mt-4" title="Scheduled maintenance">
          {data.upcomingMaintenance.map((m) => (
            <MaintenanceRow key={m.id} window={m} />
          ))}
        </Section>
      )}
    </>
  );
}
