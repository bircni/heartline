import { Link, useParams } from '@tanstack/react-router';
import { BucketBars, DayBars, DayLegend } from '../components/DayBars.tsx';
import { Icon } from '../components/Icon.tsx';
import { LatencyChart } from '../components/LatencyChart.tsx';
import { SoftwarePanel } from '../components/SoftwarePanel.tsx';
import { StatusPill } from '../components/Status.tsx';
import { Empty, ErrorNote, Kpi, PageHeader, Section, Spinner } from '../components/ui.tsx';
import { useMe, useService, useServiceSoftware } from '../lib/api.ts';
import { dateTime, duration, ms, pct, shortDay, time } from '../lib/format.ts';
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
            {data.kind.toUpperCase()} check every {every} ·{' '}
            <span className="font-mono text-[12px]">{data.target}</span>
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

      {data.description && <p className="mb-0 mt-2 text-sec">{data.description}</p>}

      {active && (
        <Link
          to="/incidents/$id"
          params={{ id: active.id }}
          className="card mt-4 flex gap-3 px-4 py-3 text-text no-underline hover:bg-hover"
        >
          <span className="mt-2 block h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--warn)' }} />
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-warn-text first-letter:uppercase">
              {active.status} · since {time(active.createdAt).slice(0, 5)}
            </div>
            <div className="text-[14px] font-medium">{active.title}</div>
            <div className="text-sec">{active.updates[0]?.message}</div>
          </div>
        </Link>
      )}

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Kpi label={`Uptime · ${days} days`} value={pct(data.kpis.uptime)} />
        <Kpi label="Average response" value={ms(data.kpis.avgLatencyMs)} />
        <Kpi label="p95" value={ms(data.kpis.p95LatencyMs)} />
        <Kpi label="Incidents" value={data.kpis.incidents} />
      </div>

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
              {daily ? 'p95' : 'Slowest check'}
            </span>
          </div>
        }
      >
        <div className="px-4 pb-3">
          <LatencyChart
            points={data.series}
            from={now - days * 86_400_000}
            to={now}
            bucketMs={data.seriesBucketMs}
            highLabel={highLabel}
          />
          <div className="ml-14 mt-2 flex justify-between text-[12px] text-muted" aria-hidden="true">
            <span>{data.bars[0] && shortDay(data.bars[0].day)}</span>
            <span>Today</span>
          </div>
        </div>
      </Section>

      <Section className="mt-3" title="Availability" actions={<DayLegend />}>
        <div className="px-4 pb-4">
          {daily ? (
            <DayBars bars={data.bars} />
          ) : (
            <BucketBars
              points={data.series}
              from={now - days * 86_400_000}
              to={now}
              bucketMs={data.seriesBucketMs}
            />
          )}
          <div className="mt-2 flex justify-between text-[12px] text-muted" aria-hidden="true">
            <span>{data.bars[0] && shortDay(data.bars[0].day)}</span>
            <span className="font-mono">{pct(data.uptime)} uptime</span>
            <span>Today</span>
          </div>
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
              <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-sec">{time(c.at)}</span>
              <span className="min-w-0 flex-1 truncate" title={c.message ?? undefined}>
                <span className="sr-only">{c.status}: </span>
                {c.message ?? c.status}
              </span>
              <span
                className="font-mono text-[12px]"
                style={{ color: c.status === 'up' ? 'var(--sec)' : CHECK_TONE[c.status] }}
              >
                {ms(c.latencyMs)}
              </span>
            </div>
          ))}
        </Section>
        <Section className="min-w-0 flex-[1_1_320px]" title={`Incidents · last ${days} days`}>
          {data.incidents.length === 0 && <Empty>No incidents in this period</Empty>}
          {data.incidents.map((i) => (
            <Link
              key={i.id}
              to="/incidents/$id"
              params={{ id: i.id }}
              className="block border-t border-hair px-4 py-3 text-text no-underline hover:bg-hover"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: i.resolvedAt ? 'var(--fill-2)' : 'var(--warn)' }}
                />
                <span className="flex-1 font-medium">{i.title}</span>
                <span className="font-mono text-[12px] text-muted">
                  {dateTime(i.createdAt)} · {duration(i.createdAt, i.resolvedAt)}
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
