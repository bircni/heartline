import { Link } from '@tanstack/react-router';
import { DayBars, DayLegend } from '../components/DayBars.tsx';
import { Icon } from '../components/Icon.tsx';
import { StatusDot, StatusLabel } from '../components/Status.tsx';
import { UrgencyBadge } from '../components/Urgency.tsx';
import { ErrorNote, PageHeader, Spinner } from '../components/ui.tsx';
import { useOverview } from '../lib/api.ts';
import { pct, relative } from '../lib/format.ts';
import { RangeControl, useRange } from './RangeControl.tsx';

export function OverviewPage() {
  const days = useRange();
  const { data, error, isPending } = useOverview(days);
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Uptime over the past ${days} days`}
        actions={<RangeControl />}
      />

      <div className="card mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
        <span className="ml-1">
          <StatusDot status={data.status} halo />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium">{data.headline}</div>
          <div className="text-sec">{data.summary}</div>
        </div>
        <span className="text-[12px] text-muted max-sm:ml-7 max-sm:w-full">
          Updated {relative(data.generatedAt)}
        </span>
      </div>

      {data.security && data.security.critical + data.security.high > 0 && (
        <Link
          to="/admin/software"
          className="card mt-3 flex items-center gap-3 px-4 py-3 text-text no-underline hover:bg-hover"
        >
          <Icon name="shield" size={16} className="shrink-0 text-bad-text" />
          <span className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium">
              {data.security.critical + data.security.high} service
              {data.security.critical + data.security.high === 1 ? '' : 's'} need
              {data.security.critical + data.security.high === 1 ? 's' : ''} an urgent update
            </span>
            <span className="text-sec">
              {' '}
              · {data.security.critical} critical, {data.security.high} high
            </span>
          </span>
          <Icon name="chevron" size={16} className="text-muted" />
        </Link>
      )}

      {data.activeIncidents.map((i) => (
        <Link
          key={i.id}
          to="/incidents/$id"
          params={{ id: i.id }}
          className="card mt-3 flex gap-3 px-4 py-3 text-text no-underline hover:bg-hover"
        >
          <span
            className="mt-2 block h-2 w-2 shrink-0 rounded-full"
            style={{ background: i.impact === 'major' ? 'var(--bad)' : 'var(--warn)' }}
          />
          <div className="min-w-0 flex-1">
            <div
              className="text-[12px] font-medium first-letter:uppercase"
              style={{ color: i.impact === 'major' ? 'var(--bad-text)' : 'var(--warn-text)' }}
            >
              {i.status} · {i.services.map((s) => s.name).join(', ') || 'all services'} ·{' '}
              {relative(i.updates[0]?.createdAt ?? i.createdAt)}
            </div>
            <div className="text-[14px] font-medium">{i.title}</div>
            <div className="line-clamp-2 text-sec">{i.updates[0]?.message}</div>
          </div>
        </Link>
      ))}

      <section className="mt-4">
        {data.groups.length === 0 && (
          <p className="card m-0 px-5 py-6 text-sec">
            No services yet. Add monitors to status.yaml or in the admin area.
          </p>
        )}
        {data.groups.map((g) => (
          <div key={g.name} className="mt-6 first:mt-0">
            <h2 className="m-0 pb-2 text-[12px] font-normal text-muted">{g.name}</h2>
            <div className="grid gap-3 xl:grid-cols-2 min-[112.5rem]:grid-cols-3">
              {g.services.map((s) => (
                <Link
                  key={s.id}
                  to="/services/$id"
                  params={{ id: s.id }}
                  search={{ days }}
                  className="card block p-4 text-text no-underline transition-colors hover:bg-hover"
                  aria-label={`${s.name}: ${s.status}, ${pct(s.uptime)} uptime. Open details.`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      {s.software?.version && (
                        <span className="shrink-0 font-mono text-[12px] text-muted">
                          v{s.software.version}
                        </span>
                      )}
                      {s.software?.urgency &&
                        s.software.urgency !== 'none' &&
                        s.software.urgency !== 'unknown' && (
                          <UrgencyBadge level={s.software.urgency} score={s.software.score} />
                        )}
                    </span>
                    <StatusLabel status={s.status} />
                  </div>
                  <div className="mt-1">
                    <DayBars bars={s.bars} />
                  </div>
                  <div
                    className="mt-2 flex items-center justify-between gap-3 text-[12px] text-muted"
                    aria-hidden="true"
                  >
                    <span>{days} days ago</span>
                    <span className="font-mono">{pct(s.uptime)} uptime</span>
                    <span>Today</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
      <div className="mt-3">
        <DayLegend />
      </div>
    </>
  );
}
