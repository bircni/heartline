import { IMPACTS, type Impact, type Incident } from '@heartline/shared';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { IncidentRow } from '../components/IncidentRow.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { UpdateTimeline } from '../components/UpdateTimeline.tsx';
import { Empty, ErrorNote, PageHeader, Section, Spinner } from '../components/ui.tsx';
import {
  useBootstrap,
  useIncident,
  useIncidentHistory,
  useIncidents,
  useMe,
  useNavOverview,
} from '../lib/api.ts';
import { can } from '../lib/roles.ts';
import {
  COMPONENT_LABEL,
  COMPONENT_TONE,
  IMPACT_LABEL,
  displayDay,
  duration,
  fullDateTime,
  incidentAge,
  incidentTone,
  monthLabel,
  zoneShort,
} from '../lib/format.ts';

export function IncidentPage() {
  const { id } = useParams({ from: '/public/incidents/$id' });
  const { data, error, isPending } = useIncident(id);
  const me = useMe();
  const boot = useBootstrap();
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
        actions={
          <>
            {open && boot.data?.subscribe.email && (
              <Link to="/subscribe" search={{ incident: data.id }} className="btn">
                <Icon name="bell" size={14} /> Follow this incident
              </Link>
            )}
            {can(me.data?.role, 'editor') && (
              <Link to="/admin/incidents" search={{ incident: data.id }} className="btn">
                <Icon name="edit" size={14} /> Manage incident
              </Link>
            )}
          </>
        }
        subtitle={
          <span className="font-medium" style={{ color: incidentTone(data).text }}>
            {IMPACT_LABEL[data.impact]}, {open ? incidentAge(data) : 'resolved'}
          </span>
        }
      />
      <dl className="card m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 px-3.5 py-3">
        {data.services.length > 0 && (
          <>
            <dt className="text-muted">Affected</dt>
            <dd className="m-0 flex flex-wrap gap-x-4 gap-y-0.5">
              {data.services.map((s) => (
                <span key={s.id}>
                  <Link to="/services/$id" params={{ id: s.id }} className="text-text">
                    {s.name}
                  </Link>{' '}
                  {/* While it is open, the status the incident gives the service. */}
                  {open && (
                    <span className="text-xs font-medium" style={{ color: COMPONENT_TONE[s.status].text }}>
                      {COMPONENT_LABEL[s.status]}
                    </span>
                  )}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt className="text-muted">Started</dt>
        <dd className="m-0">
          {fullDateTime(data.createdAt)} {zoneShort(data.createdAt)}
          {data.automatic && <span className="text-muted"> (opened automatically)</span>}
        </dd>
        {data.resolvedAt !== null && (
          <>
            <dt className="text-muted">Lasted</dt>
            <dd className="m-0">{duration(data.createdAt, data.resolvedAt)}</dd>
          </>
        )}
      </dl>

      {data.postmortem && (
        <Section title="Postmortem">
          <div className="px-3.5 py-3">
            <Markdown text={data.postmortem.body} />
            {data.postmortem.publishedAt && (
              <p className="m-0 mt-3 text-xs text-muted">
                Published {fullDateTime(data.postmortem.publishedAt)} {zoneShort(data.postmortem.publishedAt)}
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title="Updates">
        <div className="px-3.5 py-3">
          <UpdateTimeline updates={data.updates} accent={incidentTone(data).text} />
        </div>
      </Section>
    </article>
  );
}

/** Past incidents grouped by month, with open ones on top; filters and paging for long histories. */
export function IncidentHistoryPage() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [impact, setImpact] = useState<Impact | ''>('');
  const [service, setService] = useState('');
  // Search as the visitor types, but not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const open = useIncidents(true, 200);
  const history = useIncidentHistory({
    q: q || undefined,
    impact: impact || undefined,
    service: service || undefined,
  });
  const services = useNavOverview();
  const filtered = Boolean(q || impact || service);
  if (history.isPending || open.isPending) return <Spinner />;
  if (history.error) return <ErrorNote error={history.error} />;
  const past = history.data.pages.flat();
  const months = new Map<string, Incident[]>();
  for (const i of past) {
    const month = displayDay(i.createdAt).slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), i]);
  }
  const serviceOptions = [...(services.data?.groups ?? []), ...(services.data?.external ?? [])].flatMap(
    (g) => g.services,
  );

  return (
    <>
      <PageHeader title="Incidents" subtitle="Outages and disruptions with every update that was posted." />
      {!filtered && (open.data?.length ?? 0) > 0 && (
        <Section title="Open">
          {open.data?.map((i) => (
            <IncidentRow key={i.id} incident={i} variant="history" />
          ))}
        </Section>
      )}
      <div role="search" className="flex flex-wrap gap-2">
        <label htmlFor="h-q" className="sr-only">
          Search incidents
        </label>
        <input
          id="h-q"
          type="search"
          className="field min-w-0 flex-[1_1_14rem]"
          placeholder="Search titles"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label htmlFor="h-impact" className="sr-only">
          Impact
        </label>
        <select
          id="h-impact"
          className="field w-auto flex-[0_1_12rem]"
          value={impact}
          onChange={(e) => setImpact(e.target.value as Impact | '')}
        >
          <option value="">Any impact</option>
          {IMPACTS.map((i) => (
            <option key={i} value={i}>
              {IMPACT_LABEL[i]}
            </option>
          ))}
        </select>
        <label htmlFor="h-service" className="sr-only">
          Service
        </label>
        <select
          id="h-service"
          className="field w-auto flex-[0_1_12rem]"
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">All services</option>
          {serviceOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {past.length === 0 && (
        <Section>
          <Empty>{filtered ? 'No past incidents match.' : 'No incidents so far.'}</Empty>
        </Section>
      )}
      {[...months].map(([month, incidents]) => (
        <Section key={month} title={monthLabel(`${month}-01`)}>
          {incidents.map((i) => (
            <IncidentRow key={i.id} incident={i} variant="history" />
          ))}
        </Section>
      ))}
      {history.hasNextPage && (
        <button
          type="button"
          className="btn self-center"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? 'Loading…' : 'Load older incidents'}
        </button>
      )}
    </>
  );
}
