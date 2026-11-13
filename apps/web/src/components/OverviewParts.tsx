import type { Incident, Overview } from '@heartline/shared';
import { Link } from '@tanstack/react-router';
import { COMPONENT_LABEL, COMPONENT_TONE, IMPACT_LABEL, incidentTone, weekdayDay } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { UpdateTimeline } from './UpdateTimeline.tsx';

/** An open incident with all its updates, shown where the status banner would be. */
export function IncidentBox({ incident: i }: { incident: Incident }) {
  const tone = incidentTone(i);
  return (
    <section aria-label={i.title} className="card overflow-hidden" style={{ borderColor: tone.line }}>
      <div
        className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3.5 py-3"
        style={{ background: tone.bg }}
      >
        <Link
          to="/incidents/$id"
          params={{ id: i.id }}
          className="min-w-0 flex-1 text-lg font-semibold text-text no-underline hover:underline"
        >
          {i.title}
        </Link>
        <span className="text-xs font-medium" style={{ color: tone.text }}>
          {IMPACT_LABEL[i.impact]}
        </span>
      </div>
      {i.services.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-hair px-3.5 py-2 text-xs">
          {i.services.map((s) => (
            <span key={s.id} className="text-sec">
              {s.name}:{' '}
              <span className="font-medium" style={{ color: COMPONENT_TONE[s.status].text }}>
                {COMPONENT_LABEL[s.status]}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="border-t border-hair px-3.5 py-3">
        <UpdateTimeline updates={i.updates} accent={tone.text} />
      </div>
    </section>
  );
}

/** The last 15 days, each with the incidents that started on it, like a status page's "Past incidents". */
export function PastIncidents({ days }: { days: Overview['pastIncidents'] }) {
  return (
    <section aria-labelledby="past-incidents" className="card">
      <div className="panel-head">
        <h2 id="past-incidents" className="m-0 flex-1 text-base font-semibold">
          Past incidents
        </h2>
      </div>
      {days.map((d, n) => (
        <div key={d.day} className="border-t border-hair px-3.5 py-2.5">
          <h3 className="m-0 text-xs font-semibold text-sec">{weekdayDay(d.day)}</h3>
          {d.incidents.length === 0 ? (
            <p className="m-0 mt-0.5 text-sec">
              {n === 0 ? 'No incidents reported today.' : 'No incidents reported.'}
            </p>
          ) : (
            d.incidents.map((i) => (
              <div key={i.id} className="mt-1.5">
                <Link to="/incidents/$id" params={{ id: i.id }} className="font-medium text-text">
                  {i.title}
                </Link>
                <div className="mt-1">
                  <UpdateTimeline updates={i.updates} accent="var(--fill-2)" />
                </div>
              </div>
            ))
          )}
        </div>
      ))}
      <div className="border-t border-hair px-3.5 py-2">
        <Link
          to="/incidents"
          className="flex items-center gap-1 text-xs text-sec no-underline hover:text-text"
        >
          <Icon name="arrowLeft" size={13} /> Incident history
        </Link>
      </div>
    </section>
  );
}
