import { type MonitorSpec, monitorSpecSchema } from '@heartline/shared';
import type { Kysely, Transaction } from 'kysely';
import type { Plugin } from '../checks/plugins.ts';
import type { AppConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import type { Database } from '../db/schema.ts';
import { log } from '../util/log.ts';

export interface LoadedMonitor {
  id: string;
  name: string;
  group: string;
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
}

export class ValidationError extends Error {}

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
  #groupOrder: string[] = [];
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

  /** Group names in display order: config order first, then groups only used by UI-created monitors. */
  groups(): string[] {
    const extra = [...new Set(this.#monitors.map((m) => m.group))].filter(
      (g) => !this.#groupOrder.includes(g),
    );
    return [...this.#groupOrder, ...extra].filter((g) => this.#monitors.some((m) => m.group === g));
  }

  /** Makes config-defined monitors match status.yaml; UI-created monitors are left alone. */
  async reconcile(config: AppConfig): Promise<void> {
    const db = this.#db.kysely;
    const now = Date.now();
    const wanted = config.groups.flatMap((g, gi) =>
      g.monitors.map((m, mi) => ({ spec: m, group: g.name, position: gi * 1000 + mi })),
    );
    const existing = await db.selectFrom('monitors').select(['id', 'source']).execute();
    const bySource = new Map(existing.map((r) => [r.id, r.source]));

    await db.transaction().execute(async (trx) => {
      for (const w of wanted) {
        if (bySource.get(w.spec.id) === 'db') {
          log.warn('status.yaml monitor replaces a UI-created monitor with the same id', { id: w.spec.id });
        }
        const row = {
          group_name: w.group,
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
    this.#groupOrder = config.groups.map((g) => g.name);
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.#db.kysely
      .selectFrom('monitors')
      .selectAll()
      .orderBy('position')
      .orderBy('name')
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
        group: r.group_name,
        spec: parsed.data,
        source: r.source,
        paused: Boolean(r.paused),
        position: r.position,
      });
    }
    this.#monitors = next;
    for (const fn of this.#listeners) fn();
  }

  async create(spec: MonitorSpec, group: string): Promise<LoadedMonitor> {
    if (this.get(spec.id)) throw new ConflictError(`a service with id "${spec.id}" already exists`);
    const now = Date.now();
    await this.#db.kysely
      .insertInto('monitors')
      .values({
        id: spec.id,
        group_name: group,
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

  async update(id: string, spec: MonitorSpec, group: string): Promise<LoadedMonitor> {
    const current = this.require(id);
    if (current.source === 'config') throw new ConflictError('this service is managed in status.yaml');
    if (spec.id !== id) throw new ConflictError('the id of a service cannot be changed');
    await this.#db.kysely
      .updateTable('monitors')
      .set({
        group_name: group,
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
