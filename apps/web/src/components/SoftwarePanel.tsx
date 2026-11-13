import type { SoftwareDetail, SoftwareSummary } from '@heartline/shared';
import { Link } from '@tanstack/react-router';
import { relative, shortDate } from '../lib/format.ts';
import { UrgencyBadge, VulnCounts, VulnTable } from './Urgency.tsx';
import { Section } from './ui.tsx';

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="truncate text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

/**
 * Version, release and vulnerability state of a service. `summary` comes with the service detail
 * (already redacted for the viewer); `detail` is the full record for signed-in users.
 */
export function SoftwarePanel({
  serviceId,
  summary,
  detail,
  signedIn,
}: {
  serviceId: string;
  summary: SoftwareSummary;
  detail: SoftwareDetail | undefined;
  signedIn: boolean;
}) {
  const s = detail ?? summary;
  const behind = s.version && s.latest && s.version !== s.latest;
  return (
    <Section
      title={
        <span className="flex items-baseline gap-2">
          Software
          <span className="font-normal text-muted">{s.productName}</span>
        </span>
      }
      actions={
        s.urgency ? (
          <UrgencyBadge level={s.urgency} score={s.score} />
        ) : (
          <span className="text-xs text-muted">Sign in to see whether an update is due</span>
        )
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 px-3.5 py-3">
        <Stat
          label="Running"
          value={s.version ?? <span className="text-sec">unknown</span>}
          hint={
            s.versionSeenAt
              ? `seen ${relative(s.versionSeenAt)}`
              : detail?.probeError
                ? detail.probeError
                : undefined
          }
        />
        <Stat
          label="Latest release"
          value={
            s.latest ? (
              s.latestUrl ? (
                <a href={s.latestUrl} target="_blank" rel="noreferrer" className="text-text">
                  {s.latest}
                </a>
              ) : (
                s.latest
              )
            ) : (
              <span className="text-sec">–</span>
            )
          }
          hint={
            s.latestInCycle && s.latestInCycle !== s.latest
              ? `${s.latestInCycle} in cycle ${s.cycle ?? s.pinnedCycle ?? ''}`.trim()
              : s.latestPublishedAt
                ? `released ${relative(s.latestPublishedAt)}`
                : behind
                  ? 'newer than running'
                  : undefined
          }
        />
        <Stat
          label={s.pinnedCycle ? 'Release cycle (pinned)' : 'Release cycle'}
          value={s.cycle ?? s.pinnedCycle ?? <span className="text-sec">–</span>}
          hint={
            s.eolReached ? (
              <span className="text-bad-text">end-of-life{s.eol ? ` since ${shortDate(s.eol)}` : ''}</span>
            ) : s.eol ? (
              `supported until ${shortDate(s.eol)}`
            ) : undefined
          }
        />
        {s.vulns && <Stat label="Known vulnerabilities" value={<VulnCounts vulns={s.vulns} />} />}
      </div>
      {detail && detail.reasons.length > 0 && (
        <ul className="m-0 list-disc border-t border-hair px-3.5 py-3 pl-8 text-base">
          {detail.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {detail?.intelError && (
        <p className="m-0 border-t border-hair px-3.5 py-2 text-xs text-warn-text">
          Some data sources were unavailable: {detail.intelError}
        </p>
      )}
      {detail && <VulnTable vulns={detail.vulnerabilities} />}
      {detail && (
        <div className="flex flex-wrap items-center gap-4 border-t border-hair px-3.5 py-2 text-xs text-muted">
          <span>
            {detail.intelRefreshedAt
              ? `data refreshed ${relative(detail.intelRefreshedAt)}`
              : 'not refreshed yet'}
            {detail.track ? '' : ' · vulnerability tracking disabled'}
          </span>
          {detail.releasesUrl && (
            <a
              href={detail.releasesUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sec hover:text-text"
            >
              Release notes
            </a>
          )}
          {signedIn && (
            <Link
              to="/admin/software"
              search={{ service: serviceId }}
              className="text-sec no-underline hover:text-text"
            >
              Open in admin
            </Link>
          )}
        </div>
      )}
    </Section>
  );
}
