import type { Incident } from '@heartline/shared';
import { Link, useParams } from '@tanstack/react-router';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorNote, PageHeader, Section, Spinner } from '../components/ui.tsx';
import { useIncident, useIncidents } from '../lib/api.ts';
import { dateTime, duration } from '../lib/format.ts';

/** Incidents the history page loads; the API serves at most 200 per request. */
const HISTORY_LIMIT = 200;

const IMPACT_LABEL = { major: 'Major outage', partial: 'Partial outage', degraded: 'Degraded performance' };

/** Text colour of an incident: red or amber while open, grey once resolved. */
function tone(i: Incident): string {
  if (i.resolvedAt !== null) return 'var(--sec)';
  return i.impact === 'degraded' ? 'var(--warn-text)' : 'var(--bad-text)';
}

export function IncidentPage() {
  const { id } = useParams({ from: '/public/incidents/$id' });
  const { data, error, isPending } = useIncident(id);
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const open = data.resolvedAt === null;

  return (
    <article className="flex max-w-[48rem] flex-col gap-4">
      <Link
        to="/incidents"
        className="-ml-0.5 inline-flex items-center gap-1 self-start text-sec no-underline hover:text-text"
      >
        <Icon name="arrowLeft" size={15} /> Incident history
      </Link>
      <PageHeader
        title={data.title}
        subtitle={
          <span className="font-medium" style={{ color: tone(data) }}>
            {IMPACT_LABEL[data.impact]}, {open ? `ongoing for ${duration(data.createdAt, null)}` : 'resolved'}
          </span>
        }
      />
      <dl className="card m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 px-3.5 py-3">
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

      <Section title="Updates">
        {/* Newest first; the rail ties the updates into one timeline. */}
        <ol className="m-0 list-none px-3.5 py-3">
          {data.updates.map((u, i) => (
            <li key={u.id} className="relative flex gap-3.5 pb-5 last:pb-0">
              {i < data.updates.length - 1 && (
                <span aria-hidden="true" className="absolute top-3 bottom-0 left-[4.5px] w-px bg-fill-2" />
              )}
              <span
                aria-hidden="true"
                className="relative mt-[4px] block h-2.5 w-2.5 shrink-0 rounded-full border-2"
                style={{
                  background: i === 0 ? tone(data) : 'var(--surface)',
                  borderColor: i === 0 ? tone(data) : 'var(--fill-2)',
                }}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="font-semibold capitalize">{u.status}</span>
                  <span className="text-[12px] text-muted">
                    {dateTime(u.createdAt)}
                    {u.author && `, ${u.author}`}
                  </span>
                </div>
                <p className="m-0 mt-0.5 whitespace-pre-line text-sec">{u.message}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </article>
  );
}

/** One incident in the history list; open incidents are tinted red. */
function HistoryRow({ incident: i }: { incident: Incident }) {
  return (
    <Link
      to="/incidents/$id"
      params={{ id: i.id }}
      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-t border-hair px-3.5 py-2.5 text-text no-underline transition-colors first:border-t-0 hover:bg-hover ${i.resolvedAt === null ? 'bg-bad-bg' : ''}`}
    >
      <span className="min-w-0 flex-[1_1_16rem] font-medium">{i.title}</span>
      <span className="text-[12px] font-medium" style={{ color: tone(i) }}>
        {IMPACT_LABEL[i.impact]}
      </span>
      <span className="min-w-0 flex-[1_1_10rem] truncate text-[12px] text-muted">
        {i.services.map((s) => s.name).join(', ') || 'All services'}
      </span>
      <span className="text-[12px] text-sec">
        {dateTime(i.createdAt)},{' '}
        {i.resolvedAt
          ? `lasted ${duration(i.createdAt, i.resolvedAt)}`
          : `ongoing for ${duration(i.createdAt, null)}`}
      </span>
    </Link>
  );
}

/** Every incident, newest first, open ones on top. */
export function IncidentHistoryPage() {
  const { data, error, isPending } = useIncidents(false, HISTORY_LIMIT);
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const open = data.filter((i) => i.resolvedAt === null);
  const past = data.filter((i) => i.resolvedAt !== null);

  return (
    <>
      <PageHeader title="Incidents" subtitle="Outages and disruptions with every update that was posted." />
      {open.length > 0 && (
        <Section title="Open">
          {open.map((i) => (
            <HistoryRow key={i.id} incident={i} />
          ))}
        </Section>
      )}
      <Section title="Past incidents">
        {past.length === 0 ? (
          <Empty>No incidents so far.</Empty>
        ) : (
          past.map((i) => <HistoryRow key={i.id} incident={i} />)
        )}
        {data.length >= HISTORY_LIMIT && (
          <p className="m-0 border-t border-hair px-3.5 py-2.5 text-[12px] text-muted">
            Showing the {HISTORY_LIMIT} most recent incidents; older ones are not listed.
          </p>
        )}
      </Section>
    </>
  );
}
