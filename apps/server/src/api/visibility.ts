import type {
  Overview,
  ServiceDetail,
  ServiceSummary,
  SoftwareDetail,
  SoftwareSummary,
} from '@heartline/shared';
import type { Context } from 'hono';
import type { Vars } from '../auth/principal.ts';
import { scopeAtLeast } from '../auth/roles.ts';
import type { AppConfig } from '../config/schema.ts';

/**
 * What a viewer may see of a service's software state:
 * `full` for anyone with read access, `versions` for anonymous visitors when `site.showVersions`
 * is on (version and release information only), `none` otherwise.
 */
export type SoftwareVisibility = 'full' | 'versions' | 'none';

export function softwareVisibility(c: Context<Vars>, cfg: AppConfig): SoftwareVisibility {
  const p = c.get('principal');
  if (p && scopeAtLeast(p.scope, 'read')) return 'full';
  return cfg.site.showVersions ? 'versions' : 'none';
}

export function redactSummary(s: SoftwareSummary | null, vis: SoftwareVisibility): SoftwareSummary | null {
  if (!s || vis === 'none') return null;
  if (vis === 'full') return s;
  return { ...s, urgency: null, score: null, vulns: null };
}

export function redactDetail(d: SoftwareDetail, vis: SoftwareVisibility): SoftwareDetail {
  if (vis === 'full') return d;
  return {
    ...(redactSummary(d, vis) as SoftwareSummary),
    serviceId: d.serviceId,
    serviceName: d.serviceName,
    group: d.group,
    track: d.track,
    releasesUrl: d.releasesUrl,
    versionSource: d.versionSource,
    previousVersion: d.previousVersion,
    versionChangedAt: d.versionChangedAt,
    probeError: null,
    intelRefreshedAt: d.intelRefreshedAt,
    intelError: null,
    reasons: [],
    vulnerabilities: [],
  };
}

export function redactService<T extends ServiceSummary | ServiceDetail>(s: T, vis: SoftwareVisibility): T {
  return { ...s, software: redactSummary(s.software, vis) };
}

export function redactOverview(o: Overview, vis: SoftwareVisibility): Overview {
  return {
    ...o,
    groups: o.groups.map((g) => ({ ...g, services: g.services.map((s) => redactService(s, vis)) })),
    security: vis === 'full' ? o.security : null,
  };
}
