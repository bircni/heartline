import { Link, useParams } from '@tanstack/react-router';
import { BucketBars, DayBars, DayLegend, TraceAxis, bucketTicks } from '../components/DayBars.tsx';
import { Icon } from '../components/Icon.tsx';
import { LatencyChart } from '../components/LatencyChart.tsx';
import { SoftwarePanel } from '../components/SoftwarePanel.tsx';
import { StatusPill } from '../components/Status.tsx';
import { Empty, ErrorNote, PageHeader, Section, Spinner, Stats } from '../components/ui.tsx';
import { useMe, useService, useServiceSoftware } from '../lib/api.ts';
import { dateTime, dayTicks, duration, ms, pct, time } from '../lib/format.ts';
import { RangeControl, useRange } from './RangeControl.tsx';

const CHECK_TONE = { up: 'var(--ok)', degraded: 'var(--warn)', down: 'var(--bad)' } as const;

export function ServicePage() {
  const { id } = useParams({ from: '/public/services/$id' });
  const days = useRange(30);
  const { data, error, isPending } = useService(id, days);
  const me = useMe();
  // Vulnerability details need a signed-in viewer; the summary tells us whether we are one (urgency is non-null).
  const software = useServiceSoftware(id, Boolean(data?.software && data.software.urgency !== null));
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const active = data.incidents.find((i) => i.resolvedAt === null);
  const daily = data.seriesBucketMs >= 86_400_000;
  const highLabel = daily ? 'p95' : 'peak';
  const now = data.generatedAt;
  const from = now - days * 86_400_000;
  const ticks = daily ? dayTicks(data.bars.map((b) => b.day)) : bucketTicks(from, now, data.seriesBucketMs);
  const every =
    data.intervalMs >= 60_000
      ? `${Math.round(data.intervalMs / 60_000)} min`
      : `${Math.round(data.intervalMs / 1000)} s`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {data.name}
            <StatusPill status={data.status} />
          </span>
        }
        subtitle={
          <>
            {data.kind.toUpperCase()} check every {every} on{' '}
            <span className="break-all font-mono text-[12px]">{data.target}</span>
          </>
        }
        actions={
          <>
            <RangeControl fallback={30} />
            <a
              className="btn-secondary no-underline"
              href={`/api/v1/services/${encodeURIComponent(data.id)}/report.csv?days=${days}`}
              download
            >
              <Icon name="download" size={16} /> Export
            </a>
          </>
        }
      />

      {data.description && <p className="mb-0 mt-2 max-w-[75ch] text-sec">{data.description}</p>}

      {active && (
        <Link
          to="/incidents/$id"
          params={{ id: active.id }}
          className="card relative mt-4 flex gap-3 overflow-hidden py-3 pl-5 pr-4 text-text no-underline transition-colors before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-(--tone) hover:bg-hover"
          style={
            { '--tone': active.impact === 'major' ? 'var(--bad)' : 'var(--warn)' } as React.CSSProperties
          }
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[15px] font-semibold">{active.title}</span>
              <span
                className="text-[12px] font-medium first-letter:uppercase"
                style={{ color: active.impact === 'major' ? 'var(--bad-text)' : 'var(--warn-text)' }}
              >
                {active.status}, for {duration(active.createdAt, null)}
              </span>
            </div>
            <div className="max-w-[80ch] text-sec">{active.updates[0]?.message}</div>
          </div>
          <Icon name="chevron" size={16} className="mt-1 shrink-0 text-muted" />
        </Link>
      )}

      <div className="mt-5">
        <Stats
          items={[
            { label: `Uptime, ${days} days`, value: pct(data.kpis.uptime) },
            { label: 'Average response', value: ms(data.kpis.avgLatencyMs) },
            { label: '95th percentile', value: ms(data.kpis.p95LatencyMs) },
            { label: 'Incidents', value: data.kpis.incidents },
          ]}
        />
      </div>

      <Section className="mt-3" title="Availability" actions={<DayLegend />}>
        <div className="px-4 pb-4 pt-1">
          <TraceAxis ticks={ticks} className="mb-2.5" />
          {daily ? (
            <DayBars bars={data.bars} ticks={ticks} />
          ) : (
            <BucketBars points={data.series} from={from} to={now} bucketMs={data.seriesBucketMs} />
          )}
        </div>
      </Section>

      <Section
        className="mt-3"
        title="Response time"
        actions={
          <div className="flex gap-4 text-[12px] text-muted" aria-hidden="true">
            <span className="flex items-center gap-2">
              <span className="block h-0.5 w-4 rounded bg-chart" />
              Average
            </span>
            <span className="flex items-center gap-2">
              <span className="block w-4 border-t-2 border-dotted border-chart-2" />
              {daily ? '95th percentile' : 'Slowest check'}
            </span>
          </div>
        }
      >
        <div className="px-4 pb-3">
          <LatencyChart
            points={data.series}
            from={from}
            to={now}
            bucketMs={data.seriesBucketMs}
            highLabel={highLabel}
          />
        </div>
      </Section>

      {data.software && (
        <SoftwarePanel
          serviceId={data.id}
          summary={data.software}
          detail={software.data}
          signedIn={Boolean(me.data)}
        />
      )}

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <Section className="min-w-0 flex-[1_1_320px]" title="Recent checks">
          {data.checks.length === 0 && <Empty>No checks yet</Empty>}
          {data.checks.slice(0, 12).map((c) => (
            <div key={c.at} className="flex items-center gap-3 border-t border-hair px-4 py-2 text-[13px]">
              <span
                aria-hidden="true"
                className="block h-2 w-2 shrink-0 rounded-full"
                style={{ background: CHECK_TONE[c.status] }}
              />
              <span className="figure shrink-0 whitespace-nowrap text-sec">{time(c.at)}</span>
              <span className="min-w-0 flex-1 truncate" title={c.message ?? undefined}>
                <span className="sr-only">{c.status}: </span>
                {c.message ?? c.status}
              </span>
              <span
                className="figure"
                style={{ color: c.status === 'up' ? 'var(--sec)' : CHECK_TONE[c.status] }}
              >
                {ms(c.latencyMs)}
              </span>
            </div>
          ))}
        </Section>
        <Section className="min-w-0 flex-[1_1_320px]" title={`Incidents, past ${days} days`}>
          {data.incidents.length === 0 && <Empty>No incidents in this period</Empty>}
          {data.incidents.map((i) => (
            <Link
              key={i.id}
              to="/incidents/$id"
              params={{ id: i.id }}
              className="block border-t border-hair px-4 py-3 text-text no-underline hover:bg-hover"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  aria-hidden="true"
                  className="block h-2 w-2 shrink-0 self-center rounded-full"
                  style={{ background: i.resolvedAt ? 'var(--fill-2)' : 'var(--warn)' }}
                />
                <span className="min-w-0 flex-1 font-medium">{i.title}</span>
                <span className="text-[12px] text-muted">
                  {dateTime(i.createdAt)}, {i.resolvedAt ? 'lasted' : 'ongoing for'}{' '}
                  {duration(i.createdAt, i.resolvedAt)}
                </span>
              </div>
              {i.updates[0] && (
                <div className="ml-4 mt-1 line-clamp-2 text-[13px] text-sec">
                  <span className="font-medium capitalize text-text">{i.updates[0].status}</span>{' '}
                  {i.updates[0].message}
                </div>
              )}
            </Link>
          ))}
        </Section>
      </div>
    </>
  );
}
