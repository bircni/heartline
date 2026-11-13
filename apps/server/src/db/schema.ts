import type { ColumnType, Generated, Selectable } from 'kysely';

export interface MonitorTable {
  id: string;
  /** Id of the monitor_groups row. */
  group_id: string;
  name: string;
  type: string;
  spec: string;
  source: 'config' | 'db';
  position: number;
  paused: number;
  created_at: number;
  updated_at: number;
}

export interface MonitorStateTable {
  monitor_id: string;
  status: string;
  since: number;
  consecutive_failures: number;
  last_checked_at: number | null;
  last_status: string | null;
  last_latency_ms: number | null;
  last_message: string | null;
  last_notified_at: number | null;
}

export interface CheckResultTable {
  monitor_id: string;
  checked_at: number;
  status: string;
  latency_ms: number | null;
  message: string | null;
}

export interface DailyRollupTable {
  monitor_id: string;
  day: string;
  checks: number;
  up: number;
  degraded: number;
  down: number;
  maintenance: number;
  latency_sum: number;
  latency_count: number;
  latency_max: number;
  latency_p95: number | null;
}

export interface IncidentTable {
  id: string;
  title: string;
  status: string;
  impact: string;
  automatic: number;
  created_at: number;
  resolved_at: number | null;
  created_by: string | null;
  /** Impact set by hand; null when it follows the services' statuses. */
  impact_override: string | null;
  updated_at: number;
  postmortem: string | null;
  postmortem_published_at: number | null;
}

export interface IncidentServiceTable {
  incident_id: string;
  monitor_id: string;
  /** operational, degraded, partial or down. */
  status: string;
}

export interface IncidentUpdateTable {
  id: string;
  incident_id: string;
  status: string;
  message: string;
  created_at: number;
  author: string | null;
  notify: number;
}

export interface IncidentUpdateComponentTable {
  update_id: string;
  monitor_id: string;
  old_status: string | null;
  new_status: string;
}

export interface TemplateTable {
  id: string;
  kind: 'incident' | 'maintenance';
  name: string;
  title: string;
  body: string;
  status: string | null;
  impact: string | null;
  /** JSON: [{ id, status }]. */
  services: string;
  duration_ms: number | null;
  source: 'config' | 'db';
  position: number;
  created_at: number;
  updated_at: number;
}

export interface MaintenanceTable {
  id: string;
  title: string;
  description: string | null;
  starts_at: number;
  ends_at: number;
  recurrence: string | null;
  created_at: number;
  created_by: string | null;
  /** One-off windows: scheduled, in_progress, verifying or completed. Recurring ones use occurrences. */
  status: string;
  started_at: number | null;
  completed_at: number | null;
}

export interface MaintenanceUpdateTable {
  id: string;
  maintenance_id: string;
  status: string;
  message: string;
  created_at: number;
  author: string | null;
  notify: number;
}

/** What happened to one occurrence of a window; each transition is claimed once across replicas. */
export interface MaintenanceOccurrenceTable {
  maintenance_id: string;
  occurrence_start: number;
  reminded_at: number | null;
  started_at: number | null;
  completed_at: number | null;
}

export interface MaintenanceServiceTable {
  maintenance_id: string;
  monitor_id: string;
}

export interface ApiTokenTable {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}

export interface NotifierStateTable {
  notifier_id: string;
  last_sent_at: number | null;
  last_error: string | null;
}

/** better-auth's user table (only the columns we read or write). */
export interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: ColumnType<boolean | number, boolean | number, boolean | number>;
  image: string | null;
  role: string | null;
  createdAt: ColumnType<Date | string | number, Date | string | number, never>;
  updatedAt: ColumnType<Date | string | number, Date | string | number, Date | string | number>;
}

export interface AccountTable {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
}

export interface MonitorSoftwareTable {
  monitor_id: string;
  product: string;
  version: string | null;
  version_source: string | null;
  version_seen_at: number | null;
  version_changed_at: number | null;
  previous_version: string | null;
  probe_error: string | null;
  next_probe_at: Generated<number>;
  latest: string | null;
  latest_url: string | null;
  latest_published_at: number | null;
  latest_in_cycle: string | null;
  cycle: string | null;
  /** `YYYY-MM-DD`, `true`, `false` or null (unknown). */
  cycle_eol: string | null;
  eol_fetched_at: number | null;
  intel_refreshed_at: number | null;
  intel_error: string | null;
  urgency_level: Generated<string>;
  urgency_score: Generated<number>;
  /** JSON string[] */
  urgency_reasons: Generated<string>;
  notified_level: Generated<string>;
  /** 1 once vulnerabilities were evaluated at least once (first run is not announced). */
  evaluated: Generated<number>;
  updated_at: number;
}

export type MonitorSoftwareRow = Selectable<MonitorSoftwareTable>;

export interface MonitorSoftwareHistoryTable {
  monitor_id: string;
  version: string;
  seen_at: number;
}

export interface VulnerabilityTable {
  id: string;
  /** JSON string[] */
  aliases: string;
  summary: string | null;
  score: number | null;
  vector: string | null;
  severity: string;
  kev: number;
  published_at: number | null;
  modified_at: number | null;
  /** JSON string[] */
  references_json: string;
  /** JSON ('osv' | 'nvd')[] */
  sources: string;
  fetched_at: number;
}

export interface MonitorVulnerabilityTable {
  monitor_id: string;
  vuln_id: string;
  fixed_in: string | null;
  introduced: string | null;
  first_seen_at: number;
  notified_at: number | null;
}

export interface IntelCacheTable {
  key: string;
  etag: string | null;
  body: string;
  fetched_at: number;
  expires_at: number;
  status: 'ok' | 'error';
  error: string | null;
}

export interface AuditLogTable {
  id: string;
  at: number;
  actor_id: string | null;
  actor_name: string;
  actor_via: 'session' | 'token' | 'oauth' | 'system' | 'subscriber';
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  /** Redacted JSON with the changed values. */
  detail: string | null;
  ip: string | null;
}

export interface RateLimitTable {
  key: string;
  window_start: number;
  count: number;
}

export interface MonitorGroupTable {
  id: string;
  name: string;
  description: string | null;
  position: number;
  collapsed: number;
  hide_unless_degraded: number;
  source: 'config' | 'db';
  created_at: number;
  updated_at: number;
}

export interface Database {
  monitors: MonitorTable;
  monitor_state: MonitorStateTable;
  check_results: CheckResultTable;
  daily_rollups: DailyRollupTable;
  incidents: IncidentTable;
  incident_services: IncidentServiceTable;
  incident_updates: IncidentUpdateTable;
  maintenances: MaintenanceTable;
  maintenance_services: MaintenanceServiceTable;
  api_tokens: ApiTokenTable;
  notifier_state: NotifierStateTable;
  monitor_software: MonitorSoftwareTable;
  monitor_software_history: MonitorSoftwareHistoryTable;
  vulnerabilities: VulnerabilityTable;
  monitor_vulnerabilities: MonitorVulnerabilityTable;
  intel_cache: IntelCacheTable;
  audit_log: AuditLogTable;
  monitor_groups: MonitorGroupTable;
  incident_update_components: IncidentUpdateComponentTable;
  templates: TemplateTable;
  maintenance_updates: MaintenanceUpdateTable;
  maintenance_occurrences: MaintenanceOccurrenceTable;
  rate_limits: RateLimitTable;
  user: UserTable;
  account: AccountTable;
}
