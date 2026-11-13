import type { ComponentChange, IncidentUpdateDto } from '@heartline/shared';
import { COMPONENT_LABEL, COMPONENT_TONE, dateTime, zoneShort } from '../lib/format.ts';
import { Markdown } from './Markdown.tsx';

/** "API: Major outage → Operational". */
export function ComponentChanges({ changes }: { changes: ComponentChange[] }) {
  if (changes.length === 0) return null;
  return (
    <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-xs">
      {changes.map((c) => (
        <li key={c.id} className="text-sec">
          {c.name}:{' '}
          {c.oldStatus && (
            <>
              <span style={{ color: COMPONENT_TONE[c.oldStatus].text }}>{COMPONENT_LABEL[c.oldStatus]}</span>{' '}
              →{' '}
            </>
          )}
          <span className="font-medium" style={{ color: COMPONENT_TONE[c.newStatus].text }}>
            {COMPONENT_LABEL[c.newStatus]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The updates of an incident or maintenance window, newest first, on one rail. */
export function UpdateTimeline({
  updates,
  accent,
}: {
  updates: (Pick<IncidentUpdateDto, 'id' | 'status' | 'message' | 'createdAt' | 'author'> & {
    components?: ComponentChange[];
  })[];
  /** Colour of the newest dot. */
  accent: string;
}) {
  return (
    <ol className="m-0 list-none p-0">
      {updates.map((u, i) => (
        <li key={u.id} className="relative flex gap-3.5 pb-5 last:pb-0">
          {i < updates.length - 1 && (
            <span aria-hidden="true" className="absolute top-3 bottom-0 left-[4.5px] w-px bg-fill-2" />
          )}
          <span
            aria-hidden="true"
            className="relative mt-[4px] block h-2.5 w-2.5 shrink-0 rounded-full border-2"
            style={{
              background: i === 0 ? accent : 'var(--surface)',
              borderColor: i === 0 ? accent : 'var(--fill-2)',
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="font-semibold capitalize">{u.status.replace('_', ' ')}</span>
              <span className="text-xs text-muted">
                {dateTime(u.createdAt)} {zoneShort(u.createdAt)}
                {u.author && `, ${u.author}`}
              </span>
            </div>
            <Markdown text={u.message} className="mt-0.5 text-sec" />
            {u.components && <ComponentChanges changes={u.components} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
