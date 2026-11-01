import type { MonitorKind, MonitorSpec } from './schemas.ts';
import type { IMPACTS, INCIDENT_STATUSES, ROLES, SCOPES } from './schemas.ts';

export type Role = (typeof ROLES)[number];
export type Scope = (typeof SCOPES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type Impact = (typeof IMPACTS)[number];

/** Result of a single check. */
export type CheckStatus = 'up' | 'degraded' | 'down';
/** Current status of a service as shown to users. */
export type ServiceStatus = 'operational' | 'degraded' | 'down' | 'maintenance' | 'paused' | 'unknown';
export type DayState = 'operational' | 'degraded' | 'down' | 'maintenance' | 'nodata';

export interface SiteInfo {
  title: string;
  description: string | null;
  timezone: string;
  logoUrl: string | null;
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
}

export interface Overview {
  site: SiteInfo;
  status: ServiceStatus;
  headline: string;
  summary: string;
  operational: number;
  total: number;
  days: number;
  groups: { name: string; services: ServiceSummary[] }[];
  activeIncidents: Incident[];
  upcomingMaintenance: Maintenance[];
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
