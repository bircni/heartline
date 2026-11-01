import { Link } from '@tanstack/react-router';
import { DayBars, DayLegend } from '../components/DayBars.tsx';
import { StatusDot, StatusLabel } from '../components/Status.tsx';
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

      <div className="card mt-4.5 flex items-center gap-3.5 px-5 py-4.5">
        <StatusDot status={data.status} size={10} halo />
        <div className="min-w-0">
          <div className="text-[17px] font-semibold tracking-[-0.01em]">{data.headline}</div>
          <div className="text-sec">{data.summary}</div>
        </div>
      </div>

      {data.activeIncidents.map((i) => (
        <Link
          key={i.id}
          to="/incidents/$id"
          params={{ id: i.id }}
          className="card mt-3 flex gap-3 px-4 py-3.5 text-text no-underline hover:bg-hover"
        >
          <span
            className="mt-1.5 block h-2 w-2 shrink-0 rounded-full"
            style={{ background: i.impact === 'major' ? 'var(--bad)' : 'var(--warn)' }}
          />
          <div className="min-w-0 flex-1">
            <div
              className="text-[12px] font-semibold capitalize"
              style={{ color: i.impact === 'major' ? 'var(--bad-text)' : 'var(--warn-text)' }}
            >
              {i.status} · {i.services.map((s) => s.name).join(', ') || 'all services'} ·{' '}
              {relative(i.updates[0]?.createdAt ?? i.createdAt)}
            </div>
            <div className="text-[15px] font-semibold">{i.title}</div>
            <div className="line-clamp-2 text-sec">{i.updates[0]?.message}</div>
          </div>
        </Link>
      ))}

      <section className="card mt-3 overflow-hidden">
        {data.groups.length === 0 && (
          <p className="m-0 px-5 py-6 text-sec">
            No services yet. Add monitors to status.yaml or in the admin area.
          </p>
        )}
        {data.groups.map((g, gi) => (
          <div key={g.name}>
            <div
              className={`px-4.5 pb-2 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-sec ${gi ? 'border-t border-hair' : ''}`}
            >
              {g.name}
            </div>
            {g.services.map((s) => (
              <Link
                key={s.id}
                to="/services/$id"
                params={{ id: s.id }}
                search={{ days }}
                className="block border-t border-hair px-4.5 py-3.5 text-text no-underline hover:bg-hover"
                aria-label={`${s.name}: ${s.status}, ${pct(s.uptime)} uptime. Open details.`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-medium">{s.name}</span>
                  <StatusLabel status={s.status} />
                </div>
                <div className="mt-2.5">
                  <DayBars bars={s.bars} />
                </div>
                <div className="mt-2 flex items-center gap-3 text-[12px] text-sec" aria-hidden="true">
                  <span>{days} days ago</span>
                  <span className="h-px flex-1 bg-hair" />
                  <span>{pct(s.uptime)} uptime</span>
                  <span className="h-px flex-1 bg-hair" />
                  <span>Today</span>
                </div>
              </Link>
            ))}
          </div>
        ))}
      </section>
      <div className="mt-3 px-1">
        <DayLegend />
      </div>
    </>
  );
}
