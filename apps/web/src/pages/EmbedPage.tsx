import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import { StatusIcon } from '../components/Status.tsx';
import { ApiError, useOverview } from '../lib/api.ts';
import { STATUS_TONE, clock, incidentTone } from '../lib/format.ts';

/**
 * `/embed`: the current status in a small frame for other sites. `?theme=light|dark` overrides the visitor's
 * own choice. Links open the full status page in a new tab.
 */
export function EmbedPage() {
  const { data, error } = useOverview({ days: 1 });
  useEffect(() => {
    const theme = new URLSearchParams(window.location.search).get('theme');
    if (theme === 'light' || theme === 'dark')
      document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.style.background = 'transparent';
  }, []);
  if (error)
    return (
      <p className="m-0 p-3 text-sec">
        {error instanceof ApiError && error.status === 401
          ? 'This status page is private.'
          : 'Status unavailable.'}
      </p>
    );
  if (!data) return null;
  const tone = STATUS_TONE[data.status];
  const active = data.upcomingMaintenance.filter((m) => m.active);
  return (
    <div className="card overflow-hidden" style={{ borderColor: tone.line }}>
      <Link
        to="/"
        target="_blank"
        className="flex items-center gap-2.5 px-3.5 py-2.5 text-text no-underline"
        style={{ background: tone.bg }}
      >
        <StatusIcon status={data.status} size={16} />
        <span className="min-w-0 flex-1 truncate font-semibold">{data.headline}</span>
        <span className="text-xs text-sec">{data.site.title} →</span>
      </Link>
      {data.activeIncidents.map((i) => (
        <Link
          key={i.id}
          to="/incidents/$id"
          params={{ id: i.id }}
          target="_blank"
          className="block border-t border-hair px-3.5 py-2 text-text no-underline hover:bg-hover"
        >
          <span className="font-medium" style={{ color: incidentTone(i).text }}>
            {i.title}
          </span>
          <span className="ml-2 text-xs text-sec capitalize">{i.status}</span>
        </Link>
      ))}
      {active.map((m) => (
        <Link
          key={m.id}
          to="/maintenance/$id"
          params={{ id: m.id }}
          target="_blank"
          className="block border-t border-hair px-3.5 py-2 text-text no-underline hover:bg-hover"
        >
          <span className="font-medium text-maint">Maintenance: {m.title}</span>
          <span className="ml-2 text-xs text-sec">until {clock(m.nextEndsAt ?? m.endsAt)}</span>
        </Link>
      ))}
    </div>
  );
}
