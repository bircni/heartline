import type { Maintenance, Overview } from '@heartline/shared';
import { Link } from '@tanstack/react-router';
import {
  DayBars,
  DayLegend,
  TraceAxis,
  TraceViewToggle,
  traceFloor,
  useTraceView,
} from '../components/DayBars.tsx';
import { Icon } from '../components/Icon.tsx';
import { IncidentRow } from '../components/IncidentRow.tsx';
import { StatusIcon } from '../components/Status.tsx';
import { UrgencyBadge } from '../components/Urgency.tsx';
import { ErrorNote, Section, Spinner } from '../components/ui.tsx';
import { rangeQuery, useOverview } from '../lib/api.ts';
import {
  STATUS_LABEL,
  STATUS_TONE,
  clock,
  dayTicks,
  pct,
  relative,
  serviceNames,
  weekdayDate,
} from '../lib/format.ts';
import { RangeControl, rangeEndLabel, useRange } from './RangeControl.tsx';

/** The current state of everything, with the open incidents underneath. */
function StatusBanner({ data }: { data: Overview }) {
  const tone = STATUS_TONE[data.status];
  return (
    <section
      aria-labelledby="overall-status"
      className="card overflow-hidden"
      style={{ borderColor: tone.line }}
    >
      <div
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-3"
        style={{ background: tone.bg }}
      >
        <StatusIcon status={data.status} size={18} />
        <h1 id="overall-status" className="m-0 flex-1 text-[15px] font-semibold">
          {data.headline}
        </h1>
        <span className="text-[12px] text-sec">
          {data.operational} of {data.total} operational, checked {relative(data.generatedAt)}
        </span>
      </div>
      {data.activeIncidents.length > 0 ? (
        data.activeIncidents.map((i) => <IncidentRow key={i.id} incident={i} variant="summary" />)
      ) : (
        <p className="m-0 border-t border-hair px-3.5 py-2.5 text-sec">
          {data.status === 'operational' ? 'No known issues right now.' : data.summary}
        </p>
      )}
    </section>
  );
}

const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 px-3.5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_4.5rem]';

function MaintenanceRow({ window: m }: { window: Maintenance }) {
  const start = m.nextStartsAt ?? m.startsAt;
  const end = m.nextEndsAt ?? m.endsAt;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5 border-t border-hair px-3.5 py-2.5 first:border-t-0">
      <span className="min-w-0 flex-[1_1_14rem] font-medium">{m.title}</span>
      <span className="min-w-0 flex-[1_1_10rem] truncate text-sec">{serviceNames(m.services)}</span>
      <span className="text-sec">
        {m.active ? (
          <span className="font-medium text-maint">In progress until {clock(end)}</span>
        ) : (
          `${weekdayDate(start)}, ${clock(start)} – ${clock(end)}`
        )}
      </span>
    </div>
  );
}

export function OverviewPage() {
  const range = useRange();
  const [view] = useTraceView();
  const { data, error, isPending } = useOverview(range);
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const services = data.groups.flatMap((g) => g.services);
  // Every service covers the same days, so one axis and one scale serve all rows.
  const days = services[0]?.bars.map((b) => b.day) ?? [];
  const floor = traceFloor(services.flatMap((s) => s.bars.map((b) => b.uptime)));
  const urgent = data.security ? data.security.critical + data.security.high : 0;

  return (
    <>
      <StatusBanner data={data} />

      {urgent > 0 && data.security && (
        <Link
          to="/admin/software"
          className="card flex items-center gap-3 border-bad-line px-3.5 py-2.5 text-text no-underline transition-colors hover:bg-hover"
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
          <Icon name="chevron" size={15} className="shrink-0 text-muted" />
        </Link>
      )}

      <section aria-labelledby="system-status" className="card">
        <div className="panel-head">
          <h2 id="system-status" className="m-0 flex-1 text-[13px] font-semibold">
            System status
          </h2>
          <TraceViewToggle />
          <RangeControl />
        </div>
        {services.length === 0 ? (
          <p className="m-0 px-3.5 py-6 text-sec">
            No services yet. Add monitors to status.yaml or in the admin area.
          </p>
        ) : (
          <>
            <div className={`${ROW} py-2 text-[12px] text-muted`} aria-hidden="true">
              <span className="max-md:hidden">Service</span>
              <TraceAxis ticks={dayTicks(days)} end={rangeEndLabel(range)} className="max-md:col-span-2" />
              <span className="text-right max-md:hidden">Uptime</span>
            </div>
            {data.groups.map(
              (g) =>
                g.services.length > 0 && (
                  <div key={g.name}>
                    <h3 className="group-head m-0 border-t">{g.name}</h3>
                    {g.services.map((s) => (
                      <Link
                        key={s.id}
                        to="/services/$id"
                        params={{ id: s.id }}
                        search={range}
                        className={`${ROW} items-center border-b border-hair py-2 text-text no-underline transition-colors last:border-b-0 hover:bg-hover`}
                        aria-label={`${s.name}: ${STATUS_LABEL[s.status]}, ${pct(s.uptime)} uptime. Open details.`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <StatusIcon status={s.status} />
                          <span className="truncate font-medium">{s.name}</span>
                          {s.status !== 'operational' && (
                            <span
                              className="shrink-0 text-[12px] font-medium"
                              style={{ color: STATUS_TONE[s.status].text }}
                            >
                              {STATUS_LABEL[s.status]}
                            </span>
                          )}
                          {/* Running version: shown to visitors when site.showVersions is on, always when signed in. */}
                          {s.software?.version && (
                            <span className="shrink-0 font-mono text-[12px] text-muted max-sm:hidden">
                              v{s.software.version}
                            </span>
                          )}
                          {s.software?.urgency &&
                            s.software.urgency !== 'none' &&
                            s.software.urgency !== 'unknown' && (
                              <UrgencyBadge level={s.software.urgency} score={s.software.score} />
                            )}
                        </span>
                        <span className="min-w-0 max-md:order-last max-md:col-span-2">
                          <DayBars bars={s.bars} view={view} floor={floor} />
                        </span>
                        <span className="text-right text-sec" aria-hidden="true">
                          {pct(s.uptime)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ),
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hair px-3.5 py-2">
              <DayLegend />
              <span className="flex-1" />
              <a
                href={`/api/v1/report.csv?${rangeQuery(range)}`}
                className="flex items-center gap-1.5 text-[12px] text-muted no-underline hover:text-text"
              >
                <Icon name="download" size={13} /> Uptime report (CSV)
              </a>
            </div>
          </>
        )}
      </section>

      {data.upcomingMaintenance.length > 0 && (
        <Section title="Scheduled maintenance">
          {data.upcomingMaintenance.map((m) => (
            <MaintenanceRow key={m.id} window={m} />
          ))}
        </Section>
      )}
    </>
  );
}
