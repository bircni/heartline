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
    <article className="px-1 pt-2.5">
      <Link
        to="/"
        className="inline-flex items-center gap-1 py-1 text-[13px] text-sec no-underline hover:text-text"
      >
        <Icon name="arrowLeft" size={14} /> Overview
      </Link>
      <div className="mt-3 text-[13px] font-semibold capitalize" style={{ color: tone }}>
        {data.status} ·{' '}
        {data.impact === 'major'
          ? 'Major outage'
          : data.impact === 'partial'
            ? 'Partial outage'
            : 'Degraded performance'}
      </div>
      <h1 className="m-0 mt-1 text-[28px] font-semibold tracking-[-0.025em]">{data.title}</h1>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[13px] text-sec">
        {data.services.map((s, i) => (
          <span key={s.id}>
            <Link to="/services/$id" params={{ id: s.id }} className="text-text">
              {s.name}
            </Link>
            {i < data.services.length - 1 && ','}
          </span>
        ))}
        {data.services.length > 0 && <span>·</span>}
        <span>
          started {dateTime(data.createdAt)} ·{' '}
          {open
            ? `ongoing for ${duration(data.createdAt, null)}`
            : `lasted ${duration(data.createdAt, data.resolvedAt)}`}
        </span>
        {data.automatic && <span>· opened automatically</span>}
      </div>

      <ol className="card mt-5 list-none px-5 py-2">
        {data.updates.map((u, i) => (
          <li key={u.id} className="flex gap-4 border-t border-hair py-3.5 first:border-t-0">
            <div aria-hidden="true" className="flex w-3 shrink-0 flex-col items-center pt-1.5">
              <span
                className="block h-2.5 w-2.5 rounded-full border"
                style={{
                  background: i === 0 ? tone : 'transparent',
                  borderColor: i === 0 ? tone : 'var(--fill-2)',
                }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[15px] font-semibold capitalize">{u.status}</span>
                <span className="text-[12px] text-sec">
                  {dateTime(u.createdAt)}
                  {u.author && ` · ${u.author}`}
                </span>
              </div>
              <p className="m-0 mt-1 whitespace-pre-line text-[14px]">{u.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
