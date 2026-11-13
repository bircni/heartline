import type { MaintenanceStatus } from '@heartline/shared';
import { MAINTENANCE_STATUSES } from '@heartline/shared';
import { Link, useParams } from '@tanstack/react-router';
import { Icon } from '../components/Icon.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { UpdateTimeline } from '../components/UpdateTimeline.tsx';
import { ErrorNote, PageHeader, Section, Spinner } from '../components/ui.tsx';
import { useMaintenanceWindow, useMe } from '../lib/api.ts';
import { MAINTENANCE_LABEL, fullDateTime, serviceNames, zoneShort } from '../lib/format.ts';
import { can } from '../lib/roles.ts';

/** Scheduled → In progress → Verifying → Completed, with the current step marked. */
function Stepper({ status, recurring }: { status: MaintenanceStatus; recurring: boolean }) {
  const steps = MAINTENANCE_STATUSES.filter((s) => !recurring || s !== 'verifying');
  const current = steps.indexOf(status);
  return (
    <ol
      className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-xs"
      aria-label="Progress"
    >
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={`rounded-sm px-2 py-0.5 font-medium ${i === current ? 'bg-maint text-white' : i < current ? 'bg-fill text-sec' : 'text-muted'}`}
          >
            {MAINTENANCE_LABEL[s]}
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="text-muted">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function MaintenanceWindowPage() {
  const { id } = useParams({ from: '/public/maintenance/$id' });
  const { data, error, isPending } = useMaintenanceWindow(id);
  const me = useMe();
  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const start = data.nextStartsAt ?? data.startsAt;
  const end = data.nextEndsAt ?? data.endsAt;
  return (
    <article className="flex max-w-[48rem] flex-col gap-4">
      <Link
        to="/"
        className="-ml-0.5 inline-flex items-center gap-1 self-start text-sec no-underline hover:text-text"
      >
        <Icon name="arrowLeft" size={15} /> Current status
      </Link>
      <PageHeader
        title={data.title}
        subtitle={<Stepper status={data.status} recurring={data.recurrence !== null} />}
        actions={
          can(me.data?.role, 'editor') && (
            <Link to="/admin/maintenance" className="btn">
              <Icon name="edit" size={14} /> Manage
            </Link>
          )
        }
      />
      <dl className="card m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 px-3.5 py-3">
        <dt className="text-muted">{data.recurrence ? 'Next' : 'Scheduled'}</dt>
        <dd className="m-0">
          {fullDateTime(start)} – {fullDateTime(end)} {zoneShort(start)}
        </dd>
        {data.recurrence && (
          <>
            <dt className="text-muted">Repeats</dt>
            <dd className="m-0 font-mono text-xs">{data.recurrence}</dd>
          </>
        )}
        <dt className="text-muted">Affected</dt>
        <dd className="m-0">{serviceNames(data.services)}</dd>
        {data.completedAt && (
          <>
            <dt className="text-muted">Completed</dt>
            <dd className="m-0">
              {fullDateTime(data.completedAt)} {zoneShort(data.completedAt)}
            </dd>
          </>
        )}
      </dl>
      {data.description && (
        <Section title="Details">
          <div className="px-3.5 py-3">
            <Markdown text={data.description} />
          </div>
        </Section>
      )}
      {data.updates.length > 0 && (
        <Section title="Updates">
          <div className="px-3.5 py-3">
            <UpdateTimeline
              updates={data.updates.map((u) => ({ ...u, status: MAINTENANCE_LABEL[u.status] as never }))}
              accent="var(--maint)"
            />
          </div>
        </Section>
      )}
    </article>
  );
}
