import type { UpstreamIssue } from '@heartline/shared';
import { Link } from '@tanstack/react-router';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

/** Dependencies with trouble right now, shown as the likely cause of a service's own problems. */
export function UpstreamNote({ upstream }: { upstream: UpstreamIssue[] }) {
  if (upstream.length === 0) return null;
  return (
    <div className="card flex items-start gap-2 px-3.5 py-2.5">
      <Icon name="external" size={15} className="mt-[3px] shrink-0 text-muted" />
      <p className="m-0 text-sec">
        Depends on{' '}
        {upstream.map((u, i) => (
          <span key={u.id}>
            <Link to="/services/$id" params={{ id: u.id }} className="font-medium">
              {u.name}
            </Link>{' '}
            <span className="text-[12px] font-medium" style={{ color: STATUS_TONE[u.status].text }}>
              ({STATUS_LABEL[u.status].toLowerCase()})
            </span>
            {i < upstream.length - 1 ? ', ' : ''}
          </span>
        ))}
        , which may affect this service.
      </p>
    </div>
  );
}

/** Compact hint on an overview row: an icon whose tooltip names the dependencies with trouble. */
export function UpstreamHint({ upstream }: { upstream: UpstreamIssue[] }) {
  if (upstream.length === 0) return null;
  const text = `Likely cause: ${upstream.map((u) => `${u.name} ${STATUS_LABEL[u.status].toLowerCase()}`).join(', ')}`;
  return (
    <span className="flex shrink-0 text-muted" title={text}>
      <Icon name="external" size={13} />
      <span className="sr-only">{text}</span>
    </span>
  );
}
