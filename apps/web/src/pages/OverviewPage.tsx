import type { Maintenance, Overview, OverviewGroup, ServiceSummary } from '@heartline/shared';
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
import { InfoTip } from '../components/Tooltip.tsx';
import { IncidentRow } from '../components/IncidentRow.tsx';
import { StatusIcon } from '../components/Status.tsx';
import { UpstreamHint } from '../components/Upstream.tsx';
import { UrgencyBadge } from '../components/Urgency.tsx';
import { ErrorNote, Section, Spinner } from '../components/ui.tsx';
import { useStoredChoice } from '../lib/store.ts';
import { rangeQuery, useMe, useOverview } from '../lib/api.ts';
import {
  statusLabel,
  STATUS_LABEL,
  STATUS_TONE,
  clock,
  dayTicks,
  pct,
  relative,
  serviceNames,
  weekdayDate,
} from '../lib/format.ts';
import { RangeControl, rangeEndLabel, useRange, useRangeSearch } from './RangeControl.tsx';

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
        <h1 id="overall-status" className="m-0 flex-1 text-lg font-semibold">
          {data.headline}
        </h1>
        <span className="text-xs text-sec">
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
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 px-3.5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem]';

function MaintenanceRow({ window: m }: { window: Maintenance }) {
  const start = m.nextStartsAt ?? m.startsAt;
  const end = m.nextEndsAt ?? m.endsAt;
  return (
    <Link
      to="/maintenance/$id"
      params={{ id: m.id }}
      className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5 border-t border-hair px-3.5 py-2.5 text-text no-underline transition-colors first:border-t-0 hover:bg-hover"
    >
      <span className="min-w-0 flex-[1_1_14rem] font-medium">{m.title}</span>
      <span className="min-w-0 flex-[1_1_10rem] truncate text-sec">{serviceNames(m.services)}</span>
      <span className="text-sec">
        {m.active ? (
          <span className="font-medium text-maint">
            {m.status === 'verifying' ? 'Verifying' : 'In progress'} until {clock(end)}
          </span>
        ) : (
          `${weekdayDate(start)}, ${clock(start)} – ${clock(end)}`
        )}
      </span>
    </Link>
  );
}

function ServiceRow({
  s,
  view,
  floor,
}: {
  s: ServiceSummary;
  view: ReturnType<typeof useTraceView>[0];
  floor: number;
}) {
  const linkSearch = useRangeSearch();
  return (
    <Link
      to="/services/$id"
      params={{ id: s.id }}
      search={linkSearch}
      className={`${ROW} items-center border-b border-hair py-2 text-text no-underline transition-colors last:border-b-0 hover:bg-hover`}
      aria-label={`${s.name}: ${statusLabel(s.status, s.external)}, ${pct(s.uptime)} uptime. Open details.`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusIcon status={s.status} />
        <span className="truncate font-medium">{s.name}</span>
        {s.status !== 'operational' && (
          <span className="shrink-0 text-xs font-medium" style={{ color: STATUS_TONE[s.status].text }}>
            {statusLabel(s.status, s.external)}
          </span>
        )}
        {s.status !== 'operational' && <UpstreamHint upstream={s.upstream} />}
        {/* Running version: shown to visitors when site.showVersions is on, always when signed in. */}
        {s.software?.version && (
          <span className="shrink-0 font-mono text-xs text-muted max-sm:hidden">v{s.software.version}</span>
        )}
        {s.software?.urgency && s.software.urgency !== 'none' && s.software.urgency !== 'unknown' && (
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
  );
}

/**
 * A group of services. Collapsed it is one row with the group's rolled-up status and history; each visitor's
 * open or closed choice is remembered, starting from the group's `collapsed` setting.
 */
function GroupSection({
  g,
  view,
  floor,
  signedIn,
}: {
  g: OverviewGroup;
  view: ReturnType<typeof useTraceView>[0];
  floor: number;
  signedIn: boolean;
}) {
  const [state, setState] = useStoredChoice(
    `group:${g.id}`,
    ['open', 'closed'] as const,
    g.collapsed ? 'closed' : 'open',
  );
  const open = state === 'open';
  // Visitors only see a hide-unless-degraded group while something in it is wrong.
  if (g.hideUnlessDegraded && g.status === 'operational' && !signedIn) return null;
  const bodyId = `group-${g.id}`;
  return (
    <div className="border-t border-hair">
      <div className={`${ROW} items-center bg-fill py-1.5`}>
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 text-left text-xs font-medium text-sec hover:text-text"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setState(open ? 'closed' : 'open')}
          >
            <Icon
              name="chevron"
              size={13}
              className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
            />
            <span className="truncate">{g.name}</span>
          </button>
          {g.description && <InfoTip text={g.description} label={`About ${g.name}`} />}
          {!open && g.status !== 'operational' && (
            <span className="shrink-0 text-xs font-medium" style={{ color: STATUS_TONE[g.status].text }}>
              {STATUS_LABEL[g.status]}
            </span>
          )}
          {!open && <span className="shrink-0 text-xs text-muted">{g.services.length} services</span>}
          {g.hideUnlessDegraded && signedIn && (
            <span className="shrink-0 text-xs text-muted max-sm:hidden">
              hidden from visitors while operational
            </span>
          )}
        </span>
        {!open && (
          <>
            <span className="min-w-0 max-md:order-last max-md:col-span-2">
              <DayBars bars={g.bars} view={view} floor={floor} />
            </span>
            <span className="text-right text-sec" aria-hidden="true">
              {pct(g.uptime)}
            </span>
          </>
        )}
      </div>
      {open && (
        <div id={bodyId}>
          {g.services.map((s) => (
            <ServiceRow key={s.id} s={s} view={view} floor={floor} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Third-party services: their state as their status pages report it, apart from your own. */
function ExternalSection({
  data,
  days,
  range,
  view,
  floor,
  signedIn,
}: {
  data: Overview;
  signedIn: boolean;
  days: string[];
  range: ReturnType<typeof useRange>;
  view: ReturnType<typeof useTraceView>[0];
  floor: number;
}) {
  const services = data.external.flatMap((g) => g.services);
  if (services.length === 0) return null;
  const affected = services.filter((s) => s.status === 'down' || s.status === 'degraded').length;
  return (
    <section aria-labelledby="external-status" className="card">
      <div className="panel-head">
        <h2 id="external-status" className="m-0 flex-1 text-base font-semibold">
          Third-party services
        </h2>
        <span className="text-xs text-sec">
          {affected === 0 ? 'No known issues' : `${affected} with issues`}, as reported by the providers
        </span>
      </div>
      <div className={`${ROW} py-2 text-xs text-muted`} aria-hidden="true">
        <span className="max-md:hidden">Provider</span>
        <TraceAxis ticks={dayTicks(days)} end={rangeEndLabel(range)} className="max-md:col-span-2" />
        <span className="text-right max-md:hidden">Uptime</span>
      </div>
      {data.external.map((g) => (
        <GroupSection key={g.id} g={g} view={view} floor={floor} signedIn={signedIn} />
      ))}
    </section>
  );
}

export function OverviewPage() {
  const range = useRange();
  const [view] = useTraceView();
  const { data, error, isPending } = useOverview(range);
  const signedIn = Boolean(useMe().data);
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const services = data.groups.flatMap((g) => g.services);
  const external = data.external.flatMap((g) => g.services);
  // Every service covers the same days, so one axis and one scale serve all rows.
  const days = [...services, ...external][0]?.bars.map((b) => b.day) ?? [];
  const floor = traceFloor([...services, ...external].flatMap((s) => s.bars.map((b) => b.uptime)));
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
          <h2 id="system-status" className="m-0 flex-1 text-base font-semibold">
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
            <div className={`${ROW} py-2 text-xs text-muted`} aria-hidden="true">
              <span className="max-md:hidden">Service</span>
              <TraceAxis ticks={dayTicks(days)} end={rangeEndLabel(range)} className="max-md:col-span-2" />
              <span className="text-right max-md:hidden">Uptime</span>
            </div>
            {data.groups.map((g) => (
              <GroupSection key={g.id} g={g} view={view} floor={floor} signedIn={signedIn} />
            ))}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hair px-3.5 py-2">
              <DayLegend />
              <span className="flex-1" />
              <a
                href={`/api/v1/report.csv?${rangeQuery(range)}`}
                className="flex items-center gap-1.5 text-xs text-muted no-underline hover:text-text"
              >
                <Icon name="download" size={13} /> Uptime report (CSV)
              </a>
            </div>
          </>
        )}
      </section>

      <ExternalSection data={data} days={days} range={range} view={view} floor={floor} signedIn={signedIn} />

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
