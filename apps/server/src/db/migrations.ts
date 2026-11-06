import { type Kysely, sql } from 'kysely';
import { type Migration, type MigrationProvider, Migrator } from 'kysely/migration';

const ts = 'bigint' as const;

const migrations: Record<string, Migration> = {
  '0001_initial': {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('monitors')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('group_name', 'text', (c) => c.notNull())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('type', 'text', (c) => c.notNull())
        .addColumn('spec', 'text', (c) => c.notNull())
        .addColumn('source', 'text', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('paused', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('updated_at', ts, (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('monitor_state')
        .addColumn('monitor_id', 'text', (c) => c.primaryKey())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('since', ts, (c) => c.notNull())
        .addColumn('consecutive_failures', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('last_checked_at', ts)
        .addColumn('last_status', 'text')
        .addColumn('last_latency_ms', 'integer')
        .addColumn('last_message', 'text')
        .addColumn('last_notified_at', ts)
        .execute();

      await db.schema
        .createTable('check_results')
        .addColumn('monitor_id', 'text', (c) => c.notNull())
        .addColumn('checked_at', ts, (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('latency_ms', 'integer')
        .addColumn('message', 'text')
        .addPrimaryKeyConstraint('check_results_pk', ['monitor_id', 'checked_at'])
        .execute();
      await db.schema
        .createIndex('check_results_checked_at')
        .on('check_results')
        .column('checked_at')
        .execute();

      await db.schema
        .createTable('daily_rollups')
        .addColumn('monitor_id', 'text', (c) => c.notNull())
        .addColumn('day', 'text', (c) => c.notNull())
        .addColumn('checks', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('up', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('degraded', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('down', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('maintenance', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('latency_sum', ts, (c) => c.notNull().defaultTo(0))
        .addColumn('latency_count', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('latency_max', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('latency_p95', 'integer')
        .addPrimaryKeyConstraint('daily_rollups_pk', ['monitor_id', 'day'])
        .execute();

      await db.schema
        .createTable('incidents')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('impact', 'text', (c) => c.notNull())
        .addColumn('automatic', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('resolved_at', ts)
        .addColumn('created_by', 'text')
        .execute();
      await db.schema.createIndex('incidents_created_at').on('incidents').column('created_at').execute();

      await db.schema
        .createTable('incident_services')
        .addColumn('incident_id', 'text', (c) => c.notNull())
        .addColumn('monitor_id', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('incident_services_pk', ['incident_id', 'monitor_id'])
        .execute();

      await db.schema
        .createTable('incident_updates')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('incident_id', 'text', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('message', 'text', (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('author', 'text')
        .execute();
      await db.schema
        .createIndex('incident_updates_incident')
        .on('incident_updates')
        .column('incident_id')
        .execute();

      await db.schema
        .createTable('maintenances')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('description', 'text')
        .addColumn('starts_at', ts, (c) => c.notNull())
        .addColumn('ends_at', ts, (c) => c.notNull())
        .addColumn('recurrence', 'text')
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('created_by', 'text')
        .execute();

      await db.schema
        .createTable('maintenance_services')
        .addColumn('maintenance_id', 'text', (c) => c.notNull())
        .addColumn('monitor_id', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('maintenance_services_pk', ['maintenance_id', 'monitor_id'])
        .execute();

      await db.schema
        .createTable('api_tokens')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text', (c) => c.notNull())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('prefix', 'text', (c) => c.notNull())
        .addColumn('hash', 'text', (c) => c.notNull().unique())
        .addColumn('scopes', 'text', (c) => c.notNull())
        .addColumn('created_at', ts, (c) => c.notNull())
        .addColumn('last_used_at', ts)
        .addColumn('expires_at', ts)
        .execute();

      await db.schema
        .createTable('notifier_state')
        .addColumn('notifier_id', 'text', (c) => c.primaryKey())
        .addColumn('last_sent_at', ts)
        .addColumn('last_error', 'text')
        .execute();
    },
  },
  '0002_software': {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('monitor_software')
        .addColumn('monitor_id', 'text', (c) => c.primaryKey())
        .addColumn('product', 'text', (c) => c.notNull())
        .addColumn('version', 'text')
        .addColumn('version_source', 'text')
        .addColumn('version_seen_at', ts)
        .addColumn('version_changed_at', ts)
        .addColumn('previous_version', 'text')
        .addColumn('probe_error', 'text')
        .addColumn('next_probe_at', ts, (c) => c.notNull().defaultTo(0))
        .addColumn('latest', 'text')
        .addColumn('latest_in_cycle', 'text')
        .addColumn('cycle', 'text')
        .addColumn('cycle_eol', 'text')
        .addColumn('eol_fetched_at', ts)
        .addColumn('intel_refreshed_at', ts)
        .addColumn('intel_error', 'text')
        .addColumn('urgency_level', 'text', (c) => c.notNull().defaultTo('unknown'))
        .addColumn('urgency_score', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('urgency_reasons', 'text', (c) => c.notNull().defaultTo('[]'))
        .addColumn('notified_level', 'text', (c) => c.notNull().defaultTo('none'))
        .addColumn('evaluated', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('updated_at', ts, (c) => c.notNull())
        .execute();
      await db.schema
        .createIndex('monitor_software_next_probe')
        .on('monitor_software')
        .column('next_probe_at')
        .execute();

      await db.schema
        .createTable('monitor_software_history')
        .addColumn('monitor_id', 'text', (c) => c.notNull())
        .addColumn('version', 'text', (c) => c.notNull())
        .addColumn('seen_at', ts, (c) => c.notNull())
        .addPrimaryKeyConstraint('monitor_software_history_pk', ['monitor_id', 'seen_at'])
        .execute();

      await db.schema
        .createTable('vulnerabilities')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('aliases', 'text', (c) => c.notNull().defaultTo('[]'))
        .addColumn('summary', 'text')
        .addColumn('score', 'real')
        .addColumn('vector', 'text')
        .addColumn('severity', 'text', (c) => c.notNull().defaultTo('unknown'))
        .addColumn('kev', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('published_at', ts)
        .addColumn('modified_at', ts)
        .addColumn('references_json', 'text', (c) => c.notNull().defaultTo('[]'))
        .addColumn('sources', 'text', (c) => c.notNull().defaultTo('[]'))
        .addColumn('fetched_at', ts, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('vulnerabilities_kev').on('vulnerabilities').column('kev').execute();

      await db.schema
        .createTable('monitor_vulnerabilities')
        .addColumn('monitor_id', 'text', (c) => c.notNull())
        .addColumn('vuln_id', 'text', (c) => c.notNull())
        .addColumn('fixed_in', 'text')
        .addColumn('introduced', 'text')
        .addColumn('first_seen_at', ts, (c) => c.notNull())
        .addColumn('notified_at', ts)
        .addPrimaryKeyConstraint('monitor_vulnerabilities_pk', ['monitor_id', 'vuln_id'])
        .execute();
      await db.schema
        .createIndex('monitor_vulnerabilities_vuln')
        .on('monitor_vulnerabilities')
        .column('vuln_id')
        .execute();

      await db.schema
        .createTable('intel_cache')
        .addColumn('key', 'text', (c) => c.primaryKey())
        .addColumn('etag', 'text')
        .addColumn('body', 'text', (c) => c.notNull())
        .addColumn('fetched_at', ts, (c) => c.notNull())
        .addColumn('expires_at', ts, (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('error', 'text')
        .execute();
    },
  },
  '0003_software_releases': {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('monitor_software').addColumn('latest_url', 'text').execute();
      await db.schema.alterTable('monitor_software').addColumn('latest_published_at', ts).execute();
    },
  },
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

export async function migrate(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider,
    migrationTableName: 'hl_migrations',
    migrationLockTableName: 'hl_migrations_lock',
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Error') throw new Error(`migration ${r.migrationName} failed`);
  }
  if (error) throw error;
}

export { sql };
