import type { ServiceDetail } from '@heartline/shared';
import { Link, useParams } from '@tanstack/react-router';
import {
  BucketBars,
  DayBars,
  DayLegend,
  TraceAxis,
  bucketTicks,
  TraceViewToggle,
  useTraceView,
} from '../components/DayBars.tsx';
import { Icon } from '../components/Icon.tsx';
import { IncidentRow } from '../components/IncidentRow.tsx';
import { type ChartBand, LatencyChart } from '../components/LatencyChart.tsx';
import { SoftwarePanel } from '../components/SoftwarePanel.tsx';
import { UpstreamNote } from '../components/Upstream.tsx';
import { StatusPill } from '../components/Status.tsx';
import { Empty, ErrorNote, PageHeader, Section, Spinner, Stats } from '../components/ui.tsx';
import { rangeQuery, useMe, useService, useServiceSoftware } from '../lib/api.ts';
import { DAY_BG, DAY_MS, dayTicks, incidentTone, ms, pct, relative, time } from '../lib/format.ts';
import { RangeControl, rangeEndLabel, useRange } from './RangeControl.tsx';

const CHECK_TONE = {
  up: 'var(--ok)',
  degraded: 'var(--warn)',
  down: 'var(--bad)',
  maintenance: 'var(--maint)',
  unknown: 'var(--muted)',
} as const;

/** Stretches of trouble in the range, shaded behind the response-time chart like in the availability graph. */
function troubleBands(data: ServiceDetail): ChartBand[] {
  const periods =
    data.seriesBucketMs >= DAY_MS
      ? data.bars.map((b, i) => ({
          from: data.rangeStart + i * DAY_MS,
          to: data.rangeStart + (i + 1) * DAY_MS,
          state: b.state,
        }))
      : data.series.map((p) => ({
          from: p.at - data.seriesBucketMs / 2,
          to: p.at + data.seriesBucketMs / 2,
          state: p.state ?? 'nodata',
        }));
  return periods.flatMap((p) => {
    const fill = DAY_BG[p.state];
    return fill ? [{ from: p.from, to: p.to, fill }] : [];
  });
}

export function ServicePage() {
  const { id } = useParams({ from: '/public/services/$id' });
  const range = useRange(30);
  const [view] = useTraceView();
  const { data, error, isPending } = useService(id, range);
  const me = useMe();
  // Vulnerability details need a signed-in viewer; the summary tells us whether we are one (urgency is non-null).
  const software = useServiceSoftware(id, Boolean(data?.software && data.software.urgency !== null));
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const active = data.incidents.find((i) => i.resolvedAt === null);
  const daily = data.seriesBucketMs >= DAY_MS;
  // Daily points sit on calendar days, so the chart spans whole days; finer buckets end at the range end.
  const [from, to] = daily
    ? [data.rangeStart, data.rangeStart + data.bars.length * DAY_MS]
    : [data.rangeEnd - range.days * DAY_MS, data.rangeEnd];
  const traceHeight = view === 'graph' ? 120 : 34;
  const endLabel = rangeEndLabel(range);
  const every =
    data.intervalMs >= 60_000
      ? `${Math.round(data.intervalMs / 60_000)} min`
      : `${Math.round(data.intervalMs / 1000)} s`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Link to="/" search={range} className="font-normal text-muted no-underline hover:text-text">
              Overview /
            </Link>
            {data.name}
            <StatusPill status={data.status} external={data.external} />
          </span>
        }
        subtitle={
          <>
            {data.external ? 'Provider status' : `${data.kind.toUpperCase()} check`} every {every} from{' '}
            <span className="font-mono text-[12px] break-all">{data.target}</span>
            {data.lastCheckedAt && `, last checked ${relative(data.lastCheckedAt)}`}
          </>
        }
        actions={
          <>
            <RangeControl fallback={30} />
            <a
              className="btn"
              href={`/api/v1/services/${encodeURIComponent(data.id)}/report.csv?${rangeQuery(range)}`}
              download
            >
              <Icon name="download" size={14} /> Export CSV
            </a>
          </>
        }
      />

      {data.description && <p className="m-0 max-w-[75ch] text-sec">{data.description}</p>}

      <UpstreamNote upstream={data.upstream} />

      {active && (
        <div
          className="card overflow-hidden"
          style={{ background: incidentTone(active).bg, borderColor: incidentTone(active).line }}
        >
          <IncidentRow incident={active} variant="summary" />
        </div>
      )}

      <Stats
        items={
          // Provider status is read from their status page: there is no response time of the service itself.
          data.external
            ? [
                { label: `Uptime, ${range.days} days`, value: pct(data.kpis.uptime) },
                { label: 'Incidents', value: data.kpis.incidents },
              ]
            : [
                { label: `Uptime, ${range.days} days`, value: pct(data.kpis.uptime) },
                { label: 'Average response', value: ms(data.kpis.avgLatencyMs) },
                { label: '95th percentile', value: ms(data.kpis.p95LatencyMs) },
                { label: 'Incidents', value: data.kpis.incidents },
              ]
        }
      />

      <Section
        title="Availability"
        actions={
          <>
            <DayLegend />
            <TraceViewToggle />
          </>
        }
      >
        <div className="px-3.5 pt-3 pb-3">
          {daily ? (
            <DayBars bars={data.bars} view={view} height={traceHeight} />
          ) : (
            <BucketBars
              points={data.series}
              from={from}
              to={to}
              bucketMs={data.seriesBucketMs}
              view={view}
              height={traceHeight}
            />
          )}
          <TraceAxis
            ticks={daily ? dayTicks(data.bars.map((b) => b.day)) : bucketTicks(from, to, data.seriesBucketMs)}
            end={endLabel}
            className="mt-1.5"
          />
        </div>
        {data.incidents.length === 0 ? (
          <p className="m-0 border-t border-hair px-3.5 py-2.5 text-sec">No incidents in this period.</p>
        ) : (
          data.incidents.map((i) => <IncidentRow key={i.id} incident={i} variant="history" />)
        )}
      </Section>

      {!data.external && (
        <Section
          title="Response time"
          actions={
            <div className="flex gap-4 text-[12px] text-sec" aria-hidden="true">
              <span className="flex items-center gap-2">
                <span className="block h-0.5 w-3.5 bg-accent" />
                Average
              </span>
              <span className="flex items-center gap-2">
                <span className="block w-3.5 border-t-2 border-dotted border-muted" />
                {daily ? '95th percentile' : 'Slowest check'}
              </span>
            </div>
          }
        >
          <div className="px-3.5 pt-3 pb-2">
            <LatencyChart
              points={data.series}
              from={from}
              to={to}
              bucketMs={data.seriesBucketMs}
              highLabel={daily ? 'p95' : 'peak'}
              endLabel={endLabel}
              bands={troubleBands(data)}
            />
          </div>
        </Section>
      )}

      {data.software && (
        <SoftwarePanel
          serviceId={data.id}
          summary={data.software}
          detail={software.data}
          signedIn={Boolean(me.data)}
        />
      )}

      <Section title="Recent checks">
        {data.checks.length === 0 && <Empty>No checks yet</Empty>}
        {data.checks.slice(0, 12).map((c) => (
          <div
            key={c.at}
            className="flex items-center gap-3 border-t border-hair px-3.5 py-2 first:border-t-0"
          >
            <span
              aria-hidden="true"
              className="block h-2 w-2 shrink-0 rounded-full"
              style={{ background: CHECK_TONE[c.status] }}
            />
            <span className="shrink-0 whitespace-nowrap text-sec">{time(c.at)}</span>
            <span className="min-w-0 flex-1 truncate" title={c.message ?? undefined}>
              <span className="sr-only">{c.status}: </span>
              {c.message ?? c.status}
            </span>
            {!data.external && (
              <span style={{ color: c.status === 'up' ? 'var(--sec)' : CHECK_TONE[c.status] }}>
                {ms(c.latencyMs)}
              </span>
            )}
          </div>
        ))}
      </Section>
    </>
  );
}
