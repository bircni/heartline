import type { UrgencyLevel, VulnSeverity, VulnerabilityDto } from '@heartline/shared';
import { SEVERITY_TONE, URGENCY_LABEL, URGENCY_TONE, dateTime } from '../lib/format.ts';

export function UrgencyBadge({ level, score }: { level: UrgencyLevel; score?: number | null }) {
  const tone = URGENCY_TONE[level];
  return (
    <span
      className="inline-flex h-6 items-center gap-2 whitespace-nowrap rounded-md bg-fill px-2 text-xs font-medium"
      style={{ color: tone.text }}
      title={score === null || score === undefined ? undefined : `Urgency score ${score}/100`}
    >
      <span aria-hidden="true" className="block h-2 w-2 rounded-full" style={{ background: tone.dot }} />
      {URGENCY_LABEL[level]}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: VulnSeverity }) {
  return (
    <span
      aria-hidden="true"
      className="block h-2 w-2 shrink-0 rounded-full"
      style={{ background: SEVERITY_TONE[severity] }}
    />
  );
}

/** Compact counts like "1 critical · 2 high". */
export function VulnCounts({ vulns }: { vulns: Record<VulnSeverity, number> | null }) {
  if (!vulns) return <span className="text-sec">–</span>;
  const parts = (['critical', 'high', 'medium', 'low', 'unknown'] as const).filter((s) => vulns[s] > 0);
  if (parts.length === 0) return <span className="text-sec">none</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {parts.map((s) => (
        <span key={s} className="flex items-center gap-1 whitespace-nowrap">
          <SeverityDot severity={s} />
          {vulns[s]} {s}
        </span>
      ))}
    </span>
  );
}

export function VulnTable({ vulns }: { vulns: VulnerabilityDto[] }) {
  if (vulns.length === 0)
    return <p className="m-0 border-t border-hair px-4 py-3 text-sec">No known vulnerabilities</p>;
  return (
    <div>
      <div
        aria-hidden="true"
        className="flex gap-3 border-t border-hair px-4 py-2 text-xs font-medium text-sec max-sm:hidden"
      >
        <span className="w-[150px] shrink-0 pl-[17px]">Advisory</span>
        <span className="w-14 shrink-0">CVSS</span>
        <span className="flex-1">Summary</span>
        <span className="w-24 shrink-0">Fixed in</span>
      </div>
      {vulns.map((v) => (
        // On phones the summary moves to its own line below the advisory, score and fix.
        <div
          key={v.id}
          className="flex items-start gap-3 border-t border-hair px-4 py-2 text-base max-sm:flex-wrap"
        >
          <span className="flex w-[150px] shrink-0 items-start gap-2.5 pt-1">
            <SeverityDot severity={v.severity} />
            <span className="min-w-0">
              <a
                href={v.urls.nvd ?? v.urls.osv ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-mono text-xs text-text"
              >
                {v.id}
              </a>
              {v.kev && (
                <span className="mt-1 inline-block rounded-sm bg-fill px-1 text-xs font-medium text-bad-text">
                  exploited
                </span>
              )}
            </span>
          </span>
          <span className="w-14 shrink-0 pt-1 font-mono text-xs" style={{ color: SEVERITY_TONE[v.severity] }}>
            {v.score === null ? '–' : v.score.toFixed(1)}
          </span>
          <span className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pl-[17px]">
            <span className="line-clamp-2 text-text">{v.summary ?? 'No summary.'}</span>
            <span className="block text-xs text-muted">
              {v.sources.join(' + ')}
              {v.publishedAt ? ` · ${dateTime(v.publishedAt)}` : ''}
              {v.aliases.length ? ` · ${v.aliases.join(', ')}` : ''}
            </span>
          </span>
          <span className="w-24 shrink-0 pt-1 font-mono text-xs">
            {v.fixedIn ?? <span className="text-sec">no fix</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
