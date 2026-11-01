import type { ColumnType, Generated } from 'kysely';

export interface MonitorTable {
  id: string;
  group_name: string;
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
}

export interface IncidentServiceTable {
  incident_id: string;
  monitor_id: string;
}

export interface IncidentUpdateTable {
  id: string;
  incident_id: string;
  status: string;
  message: string;
  created_at: number;
  author: string | null;
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
  user: UserTable;
  account: AccountTable;
  _unused: { id: Generated<number> };
}
