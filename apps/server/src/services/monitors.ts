import { type MonitorSpec, monitorSpecSchema } from '@heartline/shared';
import type { Kysely, Transaction } from 'kysely';
import type { Plugin } from '../checks/plugins.ts';
import type { AppConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import type { Database } from '../db/schema.ts';
import { log } from '../util/log.ts';
import { configGroupId } from '../util/slug.ts';

export interface LoadedMonitor {
  id: string;
  name: string;
  /** Name of the group, for display. */
  group: string;
  groupId: string;
  spec: MonitorSpec;
  source: 'config' | 'db';
  paused: boolean;
  position: number;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/**
 * Checks references a monitor spec makes to the rest of the system (installed plugins, configured
 * notifiers). Shared by the HTTP API and MCP so both reject the same specs.
 */
export function validateMonitorSpec(
  spec: MonitorSpec,
  deps: {
    plugins: {
      get(name: string): Plugin | undefined;
      resolveArgs(p: Plugin, args: Record<string, string | number | boolean>): unknown;
    };
    notifier: { has(id: string): boolean };
    monitors?: { get(id: string): unknown };
  },
): void {
  if (spec.type === 'plugin') {
    const plugin = deps.plugins.get(spec.plugin);
    if (!plugin) throw new ValidationError(`plugin "${spec.plugin}" is not installed`);
    try {
      deps.plugins.resolveArgs(plugin, spec.args);
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  }
  const unknown = spec.notify.filter((n) => !deps.notifier.has(n));
  if (unknown.length) throw new ValidationError(`unknown notifiers: ${unknown.join(', ')}`);
  const missing = deps.monitors ? spec.dependsOn.filter((id) => !deps.monitors?.get(id)) : [];
  if (missing.length) throw new ValidationError(`unknown services in dependsOn: ${missing.join(', ')}`);
}

export class ValidationError extends Error {}

/** Placeholder the admin API returns instead of stored secrets; sending it back keeps the secret. */
export const SECRET_MASK = '••••••••';

/** The spec without secrets, for API responses. */
export function redactSpec(spec: MonitorSpec): MonitorSpec {
  if (spec.type === 'provider' && spec.m365)
    return { ...spec, m365: { ...spec.m365, clientSecret: SECRET_MASK } };
  return spec;
}

/** Puts stored secrets back where an update sent the mask. */
export function restoreSecrets(spec: MonitorSpec, current: MonitorSpec | undefined): MonitorSpec {
  if (spec.type !== 'provider' || spec.m365?.clientSecret !== SECRET_MASK) return spec;
  const stored = current?.type === 'provider' ? current.m365?.clientSecret : undefined;
  if (!stored) throw new ValidationError('m365.clientSecret is required');
  return { ...spec, m365: { ...spec.m365, clientSecret: stored } };
}

/** Deletes a monitor and everything that references it (there are no foreign keys). */
export async function purgeMonitorRows(
  trx: Kysely<Database> | Transaction<Database>,
  id: string,
): Promise<void> {
  await trx.deleteFrom('monitors').where('id', '=', id).execute();
  await trx.deleteFrom('monitor_state').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('check_results').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('daily_rollups').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('incident_services').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('maintenance_services').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('monitor_software').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('monitor_software_history').where('monitor_id', '=', id).execute();
  await trx.deleteFrom('monitor_vulnerabilities').where('monitor_id', '=', id).execute();
}

export class MonitorService {
  #db: Db;
  #monitors: LoadedMonitor[] = [];
  #listeners = new Set<() => void>();

  constructor(db: Db) {
    this.#db = db;
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  list(): LoadedMonitor[] {
    return this.#monitors;
  }

  get(id: string): LoadedMonitor | undefined {
    return this.#monitors.find((m) => m.id === id);
  }

  require(id: string): LoadedMonitor {
    const m = this.get(id);
    if (!m) throw new NotFoundError(`service "${id}" not found`);
    return m;
  }

  /** Makes config-defined monitors match status.yaml; UI-created monitors are left alone. */
  async reconcile(config: AppConfig): Promise<void> {
    const db = this.#db.kysely;
    const now = Date.now();
    const wanted = config.groups.flatMap((g) =>
      g.monitors.map((m, mi) => ({ spec: m, group: configGroupId(g), position: mi })),
    );
    const existing = await db.selectFrom('monitors').select(['id', 'source']).execute();
    const bySource = new Map(existing.map((r) => [r.id, r.source]));

    await db.transaction().execute(async (trx) => {
      for (const w of wanted) {
        if (bySource.get(w.spec.id) === 'db') {
          log.warn('status.yaml monitor replaces a UI-created monitor with the same id', { id: w.spec.id });
        }
        const row = {
          group_id: w.group,
          name: w.spec.name,
          type: w.spec.type,
          spec: JSON.stringify(w.spec),
          source: 'config' as const,
          position: w.position,
          updated_at: now,
        };
        await trx
          .insertInto('monitors')
          .values({ id: w.spec.id, ...row, paused: 0, created_at: now })
          .onConflict((oc) => oc.column('id').doUpdateSet(row))
          .execute();
      }
      const keep = new Set(wanted.map((w) => w.spec.id));
      const dropped = existing.filter((r) => r.source === 'config' && !keep.has(r.id)).map((r) => r.id);
      for (const id of dropped) await purgeMonitorRows(trx, id);
    });
    await this.reload();
    for (const m of this.#monitors) {
      const missing = m.spec.dependsOn.filter((id) => !this.get(id));
      if (missing.length) log.warn('dependsOn names unknown services, ignoring them', { id: m.id, missing });
    }
  }

  async reload(): Promise<void> {
    // Group order first, then each monitor's place in its group.
    const rows = await this.#db.kysely
      .selectFrom('monitors')
      .leftJoin('monitor_groups', 'monitor_groups.id', 'monitors.group_id')
      .selectAll('monitors')
      .select(['monitor_groups.name as group_name', 'monitor_groups.position as group_position'])
      .orderBy('group_position')
      .orderBy('monitors.group_id')
      .orderBy('monitors.position')
      .orderBy('monitors.name')
      .execute();
    const next: LoadedMonitor[] = [];
    for (const r of rows) {
      const parsed = monitorSpecSchema.safeParse(JSON.parse(r.spec));
      if (!parsed.success) {
        log.error('stored monitor spec is invalid, skipping', { id: r.id });
        continue;
      }
      next.push({
        id: r.id,
        name: r.name,
        group: r.group_name ?? r.group_id,
        groupId: r.group_id,
        spec: parsed.data,
        source: r.source,
        paused: Boolean(r.paused),
        position: r.position,
      });
    }
    this.#monitors = next;
    for (const fn of this.#listeners) fn();
  }

  /** Adds a UI-managed monitor to the group `groupId` (resolve names with GroupService first). */
  async create(spec: MonitorSpec, groupId: string): Promise<LoadedMonitor> {
    if (this.get(spec.id)) throw new ConflictError(`a service with id "${spec.id}" already exists`);
    const now = Date.now();
    await this.#db.kysely
      .insertInto('monitors')
      .values({
        id: spec.id,
        group_id: groupId,
        name: spec.name,
        type: spec.type,
        spec: JSON.stringify(spec),
        source: 'db',
        position: 100_000 + this.#monitors.length,
        paused: 0,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await this.reload();
    return this.require(spec.id);
  }

  async update(id: string, spec: MonitorSpec, groupId: string): Promise<LoadedMonitor> {
    const current = this.require(id);
    if (current.source === 'config') throw new ConflictError('this service is managed in status.yaml');
    if (spec.id !== id) throw new ConflictError('the id of a service cannot be changed');
    await this.#db.kysely
      .updateTable('monitors')
      .set({
        group_id: groupId,
        name: spec.name,
        type: spec.type,
        spec: JSON.stringify(spec),
        updated_at: Date.now(),
      })
      .where('id', '=', id)
      .execute();
    await this.reload();
    return this.require(id);
  }

  async remove(id: string): Promise<void> {
    const current = this.require(id);
    if (current.source === 'config') throw new ConflictError('this service is managed in status.yaml');
    await this.#db.kysely.transaction().execute((trx) => purgeMonitorRows(trx, id));
    await this.reload();
  }

  async setPaused(id: string, paused: boolean): Promise<LoadedMonitor> {
    this.require(id);
    await this.#db.kysely
      .updateTable('monitors')
      .set({ paused: paused ? 1 : 0, updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
    await this.reload();
    return this.require(id);
  }
}
