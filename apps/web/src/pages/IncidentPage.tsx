import { Link, useParams } from '@tanstack/react-router';
import { Icon } from '../components/Icon.tsx';
import { ErrorNote, Spinner } from '../components/ui.tsx';
import { useIncident } from '../lib/api.ts';
import { dateTime, duration } from '../lib/format.ts';

export function IncidentPage() {
  const { id } = useParams({ from: '/public/incidents/$id' });
  const { data, error, isPending } = useIncident(id);
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const open = data.resolvedAt === null;
  const tone = open ? (data.impact === 'major' ? 'var(--bad-text)' : 'var(--warn-text)') : 'var(--sec)';

  return (
    <article className="max-w-[46rem]">
      <Link
        to="/"
        className="-ml-1 inline-flex items-center gap-1 py-1 text-[13px] text-sec no-underline hover:text-text"
      >
        <Icon name="arrowLeft" size={16} /> All services
      </Link>
      <div className="mt-4 text-[13px] font-medium" style={{ color: tone }}>
        {data.impact === 'major'
          ? 'Major outage'
          : data.impact === 'partial'
            ? 'Partial outage'
            : 'Degraded performance'}
        , {open ? `ongoing for ${duration(data.createdAt, null)}` : 'resolved'}
      </div>
      <h1 className="title m-0 mt-1">{data.title}</h1>
      <dl className="m-0 mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[13px]">
        {data.services.length > 0 && (
          <>
            <dt className="text-muted">Affected</dt>
            <dd className="m-0 flex flex-wrap gap-x-3">
              {data.services.map((s) => (
                <Link key={s.id} to="/services/$id" params={{ id: s.id }} className="text-text">
                  {s.name}
                </Link>
              ))}
            </dd>
          </>
        )}
        <dt className="text-muted">Started</dt>
        <dd className="m-0">
          {dateTime(data.createdAt)}
          {data.automatic && <span className="text-muted"> (opened automatically)</span>}
        </dd>
        {data.resolvedAt !== null && (
          <>
            <dt className="text-muted">Lasted</dt>
            <dd className="m-0">{duration(data.createdAt, data.resolvedAt)}</dd>
          </>
        )}
      </dl>

      <h2 className="m-0 mt-8 text-[16px] font-semibold">Updates</h2>
      {/* Newest first; the rail ties the updates into one timeline. */}
      <ol className="m-0 mt-3 list-none p-0">
        {data.updates.map((u, i) => (
          <li key={u.id} className="relative flex gap-4 pb-6 last:pb-0">
            {i < data.updates.length - 1 && (
              <span aria-hidden="true" className="absolute bottom-0 left-[4.5px] top-3 w-px bg-fill-2" />
            )}
            <span
              aria-hidden="true"
              className="relative mt-[5px] block h-2.5 w-2.5 shrink-0 rounded-full border-2"
              style={{
                background: i === 0 ? tone : 'var(--bg)',
                borderColor: i === 0 ? tone : 'var(--fill-2)',
              }}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[14px] font-semibold capitalize">{u.status}</span>
                <span className="text-[12px] text-muted">
                  {dateTime(u.createdAt)}
                  {u.author && `, ${u.author}`}
                </span>
              </div>
              <p className="m-0 mt-1 whitespace-pre-line text-[14px] text-sec">{u.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
