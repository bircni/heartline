import type { MonitorKind, MonitorSpec } from './schemas.ts';
import type { IMPACTS, INCIDENT_STATUSES, ROLES, SCOPES, THEMES, URGENCY_LEVELS } from './schemas.ts';

export type Role = (typeof ROLES)[number];
export type Scope = (typeof SCOPES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type Impact = (typeof IMPACTS)[number];
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];
export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export type VersionSource = 'check' | 'probe' | 'plugin' | 'static';

/** Version and update state of one service. Fields after `versionSeenAt` are null for anonymous visitors. */
export interface SoftwareSummary {
  product: string;
  productName: string;
  version: string | null;
  latest: string | null;
  /** Link to the latest release (release page or changelog), when the source provides one. */
  latestUrl: string | null;
  latestPublishedAt: number | null;
  latestInCycle: string | null;
  cycle: string | null;
  /** Release cycle the operator chose to stay on (`software.pinCycle`). */
  pinnedCycle: string | null;
  /** End-of-life date (`YYYY-MM-DD`) of the running release cycle, when known. */
  eol: string | null;
  eolReached: boolean;
  versionSeenAt: number | null;
  urgency: UrgencyLevel | null;
  score: number | null;
  vulns: Record<VulnSeverity, number> | null;
}

export interface VulnerabilityDto {
  id: string;
  aliases: string[];
  summary: string | null;
  score: number | null;
  severity: VulnSeverity;
  vector: string | null;
  /** Listed in CISA's Known Exploited Vulnerabilities catalog. */
  kev: boolean;
  fixedIn: string | null;
  introduced: string | null;
  publishedAt: number | null;
  sources: ('osv' | 'nvd')[];
  urls: { osv: string | null; nvd: string | null };
  references: string[];
}

export interface SoftwareDetail extends SoftwareSummary {
  serviceId: string;
  serviceName: string;
  group: string;
  track: boolean;
  releasesUrl: string | null;
  versionSource: VersionSource | null;
  previousVersion: string | null;
  versionChangedAt: number | null;
  probeError: string | null;
  intelRefreshedAt: number | null;
  intelError: string | null;
  reasons: string[];
  vulnerabilities: VulnerabilityDto[];
}

export interface SoftwareInventory {
  generatedAt: number;
  lastRefreshAt: number | null;
  services: Omit<SoftwareDetail, 'vulnerabilities'>[];
  totals: Record<UrgencyLevel, number>;
}

export interface CatalogEntryDto {
  slug: string;
  name: string;
  endoflife: string | null;
  cpe: string | null;
  osv: { ecosystem: string; name: string } | null;
  probe: {
    path: string;
    json?: string;
    header?: string;
    regex?: string;
    auth: 'none' | 'bearer' | 'api-key';
    note?: string;
  } | null;
  /** GitHub repository used for the latest release when endoflife.date has no entry. */
  github: string | null;
  releasesUrl: string | null;
}

export interface AppVersion {
  name: string;
  version: string;
  node: string;
}

/** Result of a single check. */
export type CheckStatus = 'up' | 'degraded' | 'down';
/** Current status of a service as shown to users. */
export type ServiceStatus = 'operational' | 'degraded' | 'down' | 'maintenance' | 'paused' | 'unknown';
export type DayState = 'operational' | 'degraded' | 'down' | 'maintenance' | 'nodata';

export type Theme = (typeof THEMES)[number];

export interface SiteInfo {
  title: string;
  description: string | null;
  timezone: string;
  logoUrl: string | null;
  /** Default colour theme; visitors can pick another one for themselves. */
  theme: Theme;
}

export interface DayBar {
  day: string;
  state: DayState;
  uptime: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  checks: number;
}

export interface ServiceRef {
  id: string;
  name: string;
}

export interface ServiceSummary extends ServiceRef {
  group: string;
  kind: MonitorKind;
  status: ServiceStatus;
  uptime: number | null;
  bars: DayBar[];
  /** Null when the service has no software block or the viewer may not see versions. */
  software: SoftwareSummary | null;
}

export interface Overview {
  site: SiteInfo;
  status: ServiceStatus;
  headline: string;
  summary: string;
  operational: number;
  total: number;
  days: number;
  /** End of the covered range: now, or the end of the `to` day for a range in the past. */
  rangeEnd: number;
  groups: { name: string; services: ServiceSummary[] }[];
  activeIncidents: Incident[];
  upcomingMaintenance: Maintenance[];
  /** Services needing urgent updates; null for viewers without read access. */
  security: { critical: number; high: number } | null;
  generatedAt: number;
}

export interface CheckResultDto {
  at: number;
  status: CheckStatus;
  latencyMs: number | null;
  message: string | null;
}

export interface LatencyPoint {
  at: number;
  avgLatencyMs: number | null;
  /** p95 for daily points, the slowest check for finer buckets. */
  highLatencyMs: number | null;
  /** Availability of the bucket; null for daily points, which the day bars already cover. */
  state: DayState | null;
  checks: number | null;
  down: number | null;
}

export interface ServiceDetail extends ServiceSummary {
  description: string | null;
  target: string;
  intervalMs: number;
  lastCheckedAt: number | null;
  days: number;
  kpis: {
    uptime: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    incidents: number;
  };
  checks: CheckResultDto[];
  incidents: Incident[];
  /** Response times at the finest resolution available for the range. */
  series: LatencyPoint[];
  seriesBucketMs: number;
  /** End of the covered range: now, or the end of the `to` day for a range in the past. */
  rangeEnd: number;
  generatedAt: number;
}

export interface IncidentUpdateDto {
  id: string;
  status: IncidentStatus;
  message: string;
  createdAt: number;
  author: string | null;
}

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: Impact;
  services: ServiceRef[];
  createdAt: number;
  resolvedAt: number | null;
  automatic: boolean;
  updates: IncidentUpdateDto[];
}

export interface Maintenance {
  id: string;
  title: string;
  description: string | null;
  startsAt: number;
  endsAt: number;
  recurrence: string | null;
  /** Next (or current) occurrence for recurring windows. */
  nextStartsAt: number | null;
  nextEndsAt: number | null;
  active: boolean;
  services: ServiceRef[];
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  image: string | null;
}

export interface AdminMonitor {
  id: string;
  name: string;
  group: string;
  kind: MonitorKind;
  source: 'config' | 'db';
  paused: boolean;
  status: ServiceStatus;
  target: string;
  lastCheckedAt: number | null;
  lastMessage: string | null;
  spec: MonitorSpec;
}

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  owner: string;
}

export interface NotifierDto {
  id: string;
  type: 'teams' | 'email' | 'webhook';
  target: string;
  lastSentAt: number | null;
  lastError: string | null;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  providers: string[];
  createdAt: number;
}

export interface PluginDto {
  name: string;
  description: string | null;
  args: Record<string, { type: string; required: boolean; description: string | null }>;
}

export interface AuthProviders {
  local: boolean;
  oidc: { id: string; name: string }[];
}

export interface Bootstrap {
  site: SiteInfo;
  public: boolean;
  showVersions: boolean;
  auth: AuthProviders;
}
