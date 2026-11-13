import { type Incident, markdownToText } from '@heartline/shared';
import { Link } from '@tanstack/react-router';
import { IMPACT_LABEL, dateTime, incidentAge, incidentTone, relative, serviceNames } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

const ROW = 'border-t border-hair px-3.5 text-text no-underline transition-colors first:border-t-0';

/**
 * An incident as a link to its page.
 * - `summary`: title, status and the latest update, for incidents that are still open.
 * - `history`: one line with impact, services, start and duration, for lists of past incidents.
 * Open incidents are tinted in their impact colour, resolved ones stay neutral.
 */
export function IncidentRow({
  incident: i,
  variant,
}: {
  incident: Incident;
  variant: 'summary' | 'history';
}) {
  const tone = incidentTone(i);
  const open = i.resolvedAt === null;
  if (variant === 'summary')
    return (
      <Link
        to="/incidents/$id"
        params={{ id: i.id }}
        className={`${ROW} flex items-start gap-3 py-3 hover:bg-hover`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="font-semibold">{i.title}</span>
            <span className="text-xs font-medium capitalize" style={{ color: tone.text }}>
              {i.status}
            </span>
            <span className="text-xs text-muted">
              {serviceNames(i.services)}, updated {relative(i.updates[0]?.createdAt ?? i.createdAt)}
            </span>
          </span>
          {i.updates[0] && (
            <span className="mt-0.5 block line-clamp-2 text-sec">{markdownToText(i.updates[0].message)}</span>
          )}
        </span>
        <Icon name="chevron" size={15} className="mt-0.5 shrink-0 text-muted" />
      </Link>
    );
  return (
    <Link
      to="/incidents/$id"
      params={{ id: i.id }}
      className={`${ROW} flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-2.5 ${open ? '' : 'hover:bg-hover'}`}
      style={open ? { background: tone.bg } : undefined}
    >
      <span className="min-w-0 flex-[1_1_16rem] font-medium">{i.title}</span>
      <span className="text-xs font-medium" style={{ color: tone.text }}>
        {IMPACT_LABEL[i.impact]}
      </span>
      <span className="min-w-0 flex-[1_1_10rem] truncate text-xs text-muted">{serviceNames(i.services)}</span>
      <span className="text-xs text-sec">
        {dateTime(i.createdAt)}, {incidentAge(i)}
      </span>
    </Link>
  );
}
