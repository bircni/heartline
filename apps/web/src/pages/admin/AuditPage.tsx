import type { AuditEntryDto } from '@heartline/shared';
import { useState } from 'react';
import { Segmented } from '../../components/Segmented.tsx';
import { EmptyState, ErrorNote, PageHeader, Section, Spinner } from '../../components/ui.tsx';
import { useAuditLog } from '../../lib/api.ts';
import { dateTime } from '../../lib/format.ts';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'monitor', label: 'Monitors' },
  { value: 'incident', label: 'Incidents' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'user', label: 'Users' },
  { value: 'token', label: 'Tokens' },
  { value: 'config', label: 'Config' },
];

const VIA: Record<AuditEntryDto['actor']['via'], string> = {
  session: 'web',
  token: 'API token',
  oauth: 'OAuth',
  system: 'automatic',
  subscriber: 'subscriber',
};

function Entry({ e, first }: { e: AuditEntryDto; first: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`px-4 py-2.5 ${first ? '' : 'border-t border-hair'}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="w-36 shrink-0 text-xs text-sec">{dateTime(e.at)}</span>
        <span className="min-w-0 flex-[1_1_240px]">{e.summary}</span>
        <span className="text-xs text-sec">
          {e.actor.name} · {VIA[e.actor.via]}
          {e.ip && ` · ${e.ip}`}
        </span>
      </div>
      {e.detail && (
        <div className="mt-1 sm:pl-39">
          <button type="button" className="text-xs text-sec hover:text-text" onClick={() => setOpen(!open)}>
            {open ? 'Hide details' : 'Details'}
          </button>
          {open && (
            <pre className="m-0 mt-1 max-h-64 overflow-auto rounded-md bg-fill p-2 font-mono text-xs">
              {JSON.stringify(e.detail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const log = useAuditLog({ entityType: entityType || undefined });
  const entries = log.data?.pages.flat() ?? [];
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Who changed monitors, incidents, maintenance, users and tokens, and what happened automatically."
      />
      <div className="max-w-full overflow-x-auto">
        <Segmented size="sm" label="Show" value={entityType} onChange={setEntityType} options={FILTERS} />
      </div>
      <Section>
        {log.isPending && <Spinner />}
        {log.error && <ErrorNote error={log.error} />}
        {log.data && entries.length === 0 && (
          <EmptyState title="Nothing recorded yet">
            Changes appear here as soon as someone makes one.
          </EmptyState>
        )}
        <ol className="m-0 list-none p-0">
          {entries.map((e, i) => (
            <Entry key={e.id} e={e} first={i === 0} />
          ))}
        </ol>
        {log.hasNextPage && (
          <div className="border-t border-hair p-3 text-center">
            <button
              type="button"
              className="btn-sm"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {log.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
            </button>
          </div>
        )}
      </Section>
    </>
  );
}
