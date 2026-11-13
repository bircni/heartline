import type { MonitorKind, MonitorSpec } from './schemas.ts';
import type {
  COMPONENT_STATUSES,
  IMPACTS,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
  ROLES,
  SCOPES,
  THEMES,
  URGENCY_LEVELS,
} from './schemas.ts';

export type Role = (typeof ROLES)[number];
export type Scope = (typeof SCOPES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type Impact = (typeof IMPACTS)[number];
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];
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

/**
 * Result of a single check. `maintenance` is reported by providers; `unknown` means the status
 * could not be read (e.g. a provider's status page is unreachable) and counts neither way.
 */
export type CheckStatus = 'up' | 'degraded' | 'down' | 'maintenance' | 'unknown';
/** Current status of a service as shown to users. */
export type ServiceStatus =
  | 'operational'
  | 'degraded'
  | 'partial'
  | 'down'
  | 'maintenance'
  | 'paused'
  | 'unknown';
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

/** A dependency of a service that is not operational right now. */
export interface UpstreamIssue extends ServiceRef {
  status: ServiceStatus;
}

export interface ServiceSummary extends ServiceRef {
  /** Name of the group. */
  group: string;
  groupId: string;
  /** Shown as a tooltip next to the name. */
  description: string | null;
  kind: MonitorKind;
  /** Third-party service (provider monitor): shown apart and left out of the overall status. */
  external: boolean;
  /** What the page shows: the check's status, unless maintenance or an open incident says otherwise. */
  status: ServiceStatus;
  /** The check's own status. */
  checkStatus: ServiceStatus;
  /** The open incident that sets `status`, if one does. */
  incident: { id: string; title: string } | null;
  /** Dependencies (`dependsOn`) that are degraded, down or in maintenance: a likely cause. */
  upstream: UpstreamIssue[];
  uptime: number | null;
  bars: DayBar[];
  /** Null when the service has no software block or the viewer may not see versions. */
  software: SoftwareSummary | null;
}

/** A group of services on the status page. */
export interface GroupDto {
  id: string;
  name: string;
  description: string | null;
  /** Shown collapsed (one rolled-up row) until a visitor opens it. */
  collapsed: boolean;
  /** Hidden from visitors while every service in it is operational. */
  hideUnlessDegraded: boolean;
  source: 'config' | 'db';
  position: number;
}

/** A group on the overview: its services, plus a status and history rolled up over them. */
export interface OverviewGroup extends Omit<GroupDto, 'source' | 'position'> {
  services: ServiceSummary[];
  /** Worst status of its services (paused ones aside). */
  status: ServiceStatus;
  uptime: number | null;
  bars: DayBar[];
}

export interface Overview {
  site: SiteInfo;
  status: ServiceStatus;
  headline: string;
  summary: string;
  operational: number;
  total: number;
  days: number;
  /** Your own services; `operational`, `total` and the headline only cover these. */
  groups: OverviewGroup[];
  /** Third-party services (provider monitors) by group. */
  external: OverviewGroup[];
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
  /** Start of the first day in `bars` (site time zone). */
  rangeStart: number;
  /** End of the covered range: now, or the end of the `to` day for a range in the past. */
  rangeEnd: number;
  generatedAt: number;
}

/** A service's status changing with an incident update. */
export interface ComponentChange extends ServiceRef {
  oldStatus: ComponentStatus | null;
  newStatus: ComponentStatus;
}

export interface IncidentUpdateDto {
  id: string;
  status: IncidentStatus;
  /** Markdown. */
  message: string;
  createdAt: number;
  author: string | null;
  /** Whether subscribers and channels were told about it. */
  notify: boolean;
  /** Services whose status this update changed. */
  components: ComponentChange[];
}

/** An affected service with the status the incident gives it. */
export interface AffectedService extends ServiceRef {
  status: ComponentStatus;
}

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  /** The worst the incident got, from its services' statuses unless set by hand (`impactOverride`). */
  impact: Impact;
  impactOverride: boolean;
  services: AffectedService[];
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  automatic: boolean;
  /** Newest first. */
  updates: IncidentUpdateDto[];
  /** Null until published; the admin API also returns drafts (`publishedAt` null). */
  postmortem: { body: string; publishedAt: number | null } | null;
}

export interface TemplateDto {
  id: string;
  kind: 'incident' | 'maintenance';
  name: string;
  title: string;
  body: string;
  status: IncidentStatus | null;
  impact: Impact | null;
  services: { id: string; status: ComponentStatus | null }[];
  /** Length of a maintenance window in ms. */
  durationMs: number | null;
  source: 'config' | 'db';
}

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export interface MaintenanceUpdateDto {
  id: string;
  status: MaintenanceStatus;
  /** Markdown. */
  message: string;
  createdAt: number;
  author: string | null;
}

export interface Maintenance {
  id: string;
  title: string;
  /** Markdown. */
  description: string | null;
  startsAt: number;
  endsAt: number;
  recurrence: string | null;
  /** Next (or current) occurrence for recurring windows. */
  nextStartsAt: number | null;
  nextEndsAt: number | null;
  active: boolean;
  /** Of the window, or for a recurring one of its current or next occurrence. */
  status: MaintenanceStatus;
  /** When the window (or current occurrence) actually started and was completed. */
  startedAt: number | null;
  completedAt: number | null;
  /** Newest first; recurring windows have automatic updates per occurrence only. */
  updates: MaintenanceUpdateDto[];
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
  groupId: string;
  kind: MonitorKind;
  source: 'config' | 'db';
  paused: boolean;
  status: ServiceStatus;
  target: string;
  lastCheckedAt: number | null;
  lastMessage: string | null;
  spec: MonitorSpec;
  /** Push monitors: the URL's recognisable start and the last push. */
  push: { prefix: string; lastPushAt: number | null; lastPushStatus: string | null } | null;
  /** Only in the response that created a push monitor: its URL, shown this once. */
  pushUrl?: string;
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
  /** Profile picture from single sign-on, if any. */
  image: string | null;
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

/** One entry of the audit log: who changed what, when. */
export interface AuditEntryDto {
  id: string;
  at: number;
  actor: { id: string | null; name: string; via: 'session' | 'token' | 'oauth' | 'system' | 'subscriber' };
  /** Dotted verb, e.g. `monitor.create` or `incident.auto_resolve`. */
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  /** Changed values, with secrets removed. */
  detail: Record<string, unknown> | null;
  ip: string | null;
}
