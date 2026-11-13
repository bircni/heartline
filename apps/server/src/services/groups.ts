import type { GroupDto } from '@heartline/shared';
import type { AppConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import type { MonitorGroupTable } from '../db/schema.ts';
import { configGroupId, slugify } from '../util/slug.ts';
import { ConflictError, NotFoundError } from './monitors.ts';

/** Groups created in the UI or API sort after the ones from status.yaml. */
const DB_POSITION = 100_000;

export interface GroupInput {
  name: string;
  description?: string | null;
  collapsed?: boolean;
  hideUnlessDegraded?: boolean;
}

const toDto = (r: MonitorGroupTable): GroupDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  collapsed: Boolean(r.collapsed),
  hideUnlessDegraded: Boolean(r.hide_unless_degraded),
  source: r.source,
  position: r.position,
});

/** Groups of services: from status.yaml (read-only in the UI) or created in the UI and API. */
export class GroupService {
  readonly #db: Db;
  #groups: GroupDto[] = [];

  constructor(db: Db) {
    this.#db = db;
  }

  /** All groups in display order. */
  list(): GroupDto[] {
    return this.#groups;
  }

  get(id: string): GroupDto | undefined {
    return this.#groups.find((g) => g.id === id);
  }

  require(id: string): GroupDto {
    const g = this.get(id);
    if (!g) throw new NotFoundError(`group "${id}" not found`);
    return g;
  }

  /** A group by id or (case-insensitive) name. */
  find(idOrName: string): GroupDto | undefined {
    const lower = idOrName.trim().toLowerCase();
    return this.get(idOrName) ?? this.#groups.find((g) => g.name.toLowerCase() === lower);
  }

  async reload(): Promise<void> {
    const rows = await this.#db.kysely
      .selectFrom('monitor_groups')
      .selectAll()
      .orderBy('position')
      .orderBy('name')
      .execute();
    this.#groups = rows.map(toDto);
  }

  /** Makes groups from status.yaml match the file. Call `prune` once the monitors are reconciled too. */
  async reconcile(config: AppConfig, now = Date.now()): Promise<void> {
    await this.#db.kysely.transaction().execute(async (trx) => {
      for (const [i, g] of config.groups.entries()) {
        const row = {
          name: g.name,
          description: g.description ?? null,
          position: i,
          collapsed: g.collapsed ? 1 : 0,
          hide_unless_degraded: g.hideUnlessDegraded ? 1 : 0,
          source: 'config' as const,
          updated_at: now,
        };
        await trx
          .insertInto('monitor_groups')
          .values({ id: configGroupId(g), ...row, created_at: now })
          .onConflict((oc) => oc.column('id').doUpdateSet(row))
          .execute();
      }
    });
    await this.reload();
  }

  /**
   * Groups that left status.yaml: deleted when empty, otherwise kept as UI-managed groups so the monitors
   * created in the UI that use them keep their place.
   */
  async prune(config: AppConfig, now = Date.now()): Promise<void> {
    const wanted = new Set(config.groups.map(configGroupId));
    const stale = this.#groups.filter((g) => g.source === 'config' && !wanted.has(g.id));
    for (const g of stale) {
      const used = await this.#db.kysely
        .selectFrom('monitors')
        .select('id')
        .where('group_id', '=', g.id)
        .limit(1)
        .executeTakeFirst();
      if (used)
        await this.#db.kysely
          .updateTable('monitor_groups')
          .set({ source: 'db', position: DB_POSITION + g.position, updated_at: now })
          .where('id', '=', g.id)
          .execute();
      else await this.#db.kysely.deleteFrom('monitor_groups').where('id', '=', g.id).execute();
    }
    if (stale.length) await this.reload();
  }

  async create(input: GroupInput & { id?: string }, now = Date.now()): Promise<GroupDto> {
    const base = input.id ?? slugify(input.name);
    let id = base;
    if (input.id && this.get(id)) throw new ConflictError(`a group with id "${id}" already exists`);
    for (let n = 2; this.get(id); n++) id = `${base}-${n}`;
    const last = Math.max(
      DB_POSITION,
      ...this.#groups.filter((g) => g.source === 'db').map((g) => g.position),
    );
    await this.#db.kysely
      .insertInto('monitor_groups')
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        position: last + 1,
        collapsed: input.collapsed ? 1 : 0,
        hide_unless_degraded: input.hideUnlessDegraded ? 1 : 0,
        source: 'db',
        created_at: now,
        updated_at: now,
      })
      .execute();
    await this.reload();
    return this.require(id);
  }

  async update(id: string, input: Partial<GroupInput>, now = Date.now()): Promise<GroupDto> {
    const g = this.require(id);
    if (g.source === 'config') throw new ConflictError('this group is managed in status.yaml');
    await this.#db.kysely
      .updateTable('monitor_groups')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.collapsed !== undefined ? { collapsed: input.collapsed ? 1 : 0 } : {}),
        ...(input.hideUnlessDegraded !== undefined
          ? { hide_unless_degraded: input.hideUnlessDegraded ? 1 : 0 }
          : {}),
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
    await this.reload();
    return this.require(id);
  }

  async remove(id: string): Promise<void> {
    const g = this.require(id);
    if (g.source === 'config') throw new ConflictError('this group is managed in status.yaml');
    const used = await this.#db.kysely
      .selectFrom('monitors')
      .select('id')
      .where('group_id', '=', id)
      .limit(1)
      .executeTakeFirst();
    if (used) throw new ConflictError('move or delete the services in this group first');
    await this.#db.kysely.deleteFrom('monitor_groups').where('id', '=', id).execute();
    await this.reload();
  }

  /** Puts the UI-managed groups in the given order; groups from status.yaml keep the file's order. */
  async reorder(ids: string[], now = Date.now()): Promise<GroupDto[]> {
    for (const id of ids) {
      const g = this.require(id);
      if (g.source === 'config') throw new ConflictError(`group "${id}" is managed in status.yaml`);
    }
    await this.#db.kysely.transaction().execute(async (trx) => {
      for (const [i, id] of ids.entries())
        await trx
          .updateTable('monitor_groups')
          .set({ position: DB_POSITION + 1 + i, updated_at: now })
          .where('id', '=', id)
          .execute();
    });
    await this.reload();
    return this.list();
  }
}
