import type {
  ComponentStatus,
  Impact,
  Incident,
  IncidentStatus,
  IncidentUpdateDto,
  incidentCreateSchema,
  incidentPatchSchema,
  incidentUpdateCreateSchema,
} from '@heartline/shared';
import { affected, deriveImpact, maxImpact } from '@heartline/shared';
import { sql } from 'kysely';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { IncidentTable } from '../db/schema.ts';
import type { NotifierService } from '../notify/index.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/log.ts';
import { type MonitorService, NotFoundError, ValidationError } from './monitors.ts';

/** An update or incident dated further back than this is a write-up after the fact: it never notifies. */
const BACKFILL_MS = 60_000;

const COMPONENT_RANK: Record<ComponentStatus, number> = { operational: 0, degraded: 1, partial: 2, down: 3 };

/** An update people may hear about; `notify` is its switch (automatic incidents decide by setting). */
export interface IncidentEvent {
  incident: Incident;
  update: IncidentUpdateDto;
  notify: boolean;
  postmortem?: boolean;
}

/** What open incidents say about one service: its worst status among them, and the incident saying so. */
export interface IncidentOverride {
  status: ComponentStatus;
  incident: { id: string; title: string };
}

/**
 * When an incident was resolved: the first "resolved" update after the last update that was not, or null
 * while it is open. Updates can be backfilled out of order, so this goes by their times, not insertion.
 */
function resolvedAtOf(updates: { status: string; created_at: number }[]): number | null {
  const sorted = [...updates].sort((a, b) => a.created_at - b.created_at);
  let resolved: number | null = null;
  for (const u of sorted) {
    if (u.status !== 'resolved') resolved = null;
    else resolved ??= u.created_at;
  }
  return resolved;
}

export class IncidentService {
  #db: Db;
  #monitors: MonitorService;
  #notifier: NotifierService;
  notifyIncidents = true;
  /** Further listeners (subscriber e-mails) for posted updates; failures are logged, never thrown. */
  readonly listeners: ((e: IncidentEvent) => Promise<void>)[] = [];

  constructor(db: Db, monitors: MonitorService, notifier: NotifierService) {
    this.#db = db;
    this.#monitors = monitors;
    this.#notifier = notifier;
  }

  #name(id: string): string {
    return this.#monitors.get(id)?.name ?? id;
  }

  async #hydrate(rows: IncidentTable[], drafts: boolean): Promise<Incident[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const db = this.#db.kysely;
    const [links, updates] = await Promise.all([
      db.selectFrom('incident_services').selectAll().where('incident_id', 'in', ids).execute(),
      db
        .selectFrom('incident_updates')
        .selectAll()
        .where('incident_id', 'in', ids)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
    ]);
    const changes = updates.length
      ? await db
          .selectFrom('incident_update_components')
          .selectAll()
          .where(
            'update_id',
            'in',
            updates.map((u) => u.id),
          )
          .execute()
      : [];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as IncidentStatus,
      impact: r.impact as Impact,
      impactOverride: r.impact_override !== null,
      automatic: Boolean(r.automatic),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
      services: links
        .filter((l) => l.incident_id === r.id)
        .map((l) => ({
          id: l.monitor_id,
          name: this.#name(l.monitor_id),
          status: l.status as ComponentStatus,
        })),
      updates: updates
        .filter((u) => u.incident_id === r.id)
        .map((u): IncidentUpdateDto => ({
          id: u.id,
          status: u.status as IncidentStatus,
          message: u.message,
          createdAt: u.created_at,
          author: u.author,
          notify: Boolean(u.notify),
          components: changes
            .filter((c) => c.update_id === u.id)
            .map((c) => ({
              id: c.monitor_id,
              name: this.#name(c.monitor_id),
              oldStatus: c.old_status as ComponentStatus | null,
              newStatus: c.new_status as ComponentStatus,
            })),
        })),
      postmortem:
        r.postmortem && (drafts || r.postmortem_published_at !== null)
          ? { body: r.postmortem, publishedAt: r.postmortem_published_at }
          : null,
    }));
  }

  async list(
    opts: {
      activeOnly?: boolean;
      resolvedOnly?: boolean;
      since?: number;
      until?: number;
      monitorId?: string;
      limit?: number;
      /** Only incidents after this one in the newest-first order (a page cursor). */
      before?: { createdAt: number; id: string };
      /** Case-insensitive text in the title. */
      search?: string;
      impact?: Impact;
      /** Include unpublished postmortems (admin views). */
      drafts?: boolean;
    } = {},
  ): Promise<Incident[]> {
    let q = this.#db.kysely
      .selectFrom('incidents')
      .selectAll('incidents')
      .orderBy('incidents.created_at', 'desc')
      .orderBy('incidents.id', 'desc');
    if (opts.activeOnly) q = q.where('incidents.resolved_at', 'is', null);
    if (opts.resolvedOnly) q = q.where('incidents.resolved_at', 'is not', null);
    if (opts.before) {
      const { createdAt, id } = opts.before;
      q = q.where((eb) =>
        eb.or([
          eb('incidents.created_at', '<', createdAt),
          eb.and([eb('incidents.created_at', '=', createdAt), eb('incidents.id', '<', id)]),
        ]),
      );
    }
    if (opts.search) {
      const pattern = `%${opts.search.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      q = q.where(sql<boolean>`lower(incidents.title) like ${pattern} escape '\\'`);
    }
    if (opts.impact) q = q.where('incidents.impact', '=', opts.impact);
    if (opts.since !== undefined) {
      const since = opts.since;
      q = q.where((eb) =>
        eb.or([
          eb('incidents.resolved_at', 'is', null),
          eb('incidents.resolved_at', '>=', since),
          eb('incidents.created_at', '>=', since),
        ]),
      );
    }
    if (opts.until !== undefined) q = q.where('incidents.created_at', '<', opts.until);
    if (opts.monitorId) {
      q = q
        .innerJoin('incident_services', 'incident_services.incident_id', 'incidents.id')
        .where('incident_services.monitor_id', '=', opts.monitorId);
    }
    if (opts.limit) q = q.limit(opts.limit);
    return this.#hydrate(await q.execute(), opts.drafts ?? false);
  }

  async get(id: string, opts: { drafts?: boolean } = {}): Promise<Incident> {
    const row = await this.#db.kysely
      .selectFrom('incidents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`incident "${id}" not found`);
    return (await this.#hydrate([row], opts.drafts ?? false))[0] as Incident;
  }

  async create(
    input: z.output<typeof incidentCreateSchema>,
    author: string | null,
    automatic = false,
    now = Date.now(),
  ): Promise<Incident> {
    const services = affected(input.services, input.impact);
    for (const s of services) this.#monitors.require(s.id);
    const createdAt = input.createdAt?.getTime() ?? now;
    if (createdAt > now + BACKFILL_MS) throw new ValidationError('createdAt cannot be in the future');
    const backfill = createdAt < now - BACKFILL_MS;
    const notify = input.notify && !backfill;
    // Without services the impact cannot be derived; such incidents stay "degraded" unless set.
    const impact =
      input.impact ?? (services.length ? deriveImpact(services.map((s) => s.status)) : 'degraded');
    const id = newId();
    const updateId = newId();
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .insertInto('incidents')
        .values({
          id,
          title: input.title,
          status: input.status,
          impact,
          impact_override: input.impact ?? null,
          automatic: automatic ? 1 : 0,
          created_at: createdAt,
          updated_at: createdAt,
          resolved_at: input.status === 'resolved' ? createdAt : null,
          created_by: author,
          postmortem: null,
          postmortem_published_at: null,
        })
        .execute();
      for (const s of services)
        await trx
          .insertInto('incident_services')
          .values({ incident_id: id, monitor_id: s.id, status: s.status })
          .execute();
      await trx
        .insertInto('incident_updates')
        .values({
          id: updateId,
          incident_id: id,
          status: input.status,
          message: input.message,
          created_at: createdAt,
          author,
          notify: notify ? 1 : 0,
        })
        .execute();
      for (const s of services)
        await trx
          .insertInto('incident_update_components')
          .values({ update_id: updateId, monitor_id: s.id, old_status: null, new_status: s.status })
          .execute();
    });
    const incident = await this.get(id);
    const update = incident.updates[0] as IncidentUpdateDto;
    if (notify && this.notifyIncidents) await this.#notifier.send({ kind: 'incident', incident, update });
    // Written-up incidents are history: nobody hears about them, not even for automatic ones.
    if (!backfill) await this.#tell({ incident, update, notify });
    return incident;
  }

  async #tell(e: IncidentEvent): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l(e);
      } catch (error) {
        log.error('incident listener failed', { error });
      }
    }
  }

  async addUpdate(
    id: string,
    input: z.output<typeof incidentUpdateCreateSchema>,
    author: string | null,
    now = Date.now(),
  ): Promise<Incident> {
    const current = await this.get(id);
    const changes = affected(input.services ?? [], current.impact)
      .map((s) => ({ ...s, old: current.services.find((c) => c.id === s.id)?.status ?? null }))
      .filter((s) => s.old !== s.status);
    for (const s of changes) this.#monitors.require(s.id);
    const createdAt = input.createdAt?.getTime() ?? now;
    if (createdAt > now + BACKFILL_MS) throw new ValidationError('createdAt cannot be in the future');
    if (createdAt < current.createdAt)
      throw new ValidationError('an update cannot be older than its incident');
    const backfill = createdAt < now - BACKFILL_MS;
    const notify = input.notify && !backfill;
    const updateId = newId();
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .insertInto('incident_updates')
        .values({
          id: updateId,
          incident_id: id,
          status: input.status,
          message: input.message,
          created_at: createdAt,
          author,
          notify: notify ? 1 : 0,
        })
        .execute();
      for (const s of changes) {
        await trx
          .insertInto('incident_services')
          .values({ incident_id: id, monitor_id: s.id, status: s.status })
          .onConflict((oc) => oc.columns(['incident_id', 'monitor_id']).doUpdateSet({ status: s.status }))
          .execute();
        await trx
          .insertInto('incident_update_components')
          .values({ update_id: updateId, monitor_id: s.id, old_status: s.old, new_status: s.status })
          .execute();
      }
      // Status and resolution follow the latest update by time, so a backfilled update lands in place.
      const all = await trx
        .selectFrom('incident_updates')
        .select(['status', 'created_at', 'id'])
        .where('incident_id', '=', id)
        .execute();
      const latest = [...all].sort((a, b) => b.created_at - a.created_at || (b.id === updateId ? 1 : -1))[0];
      const statuses = (
        await trx.selectFrom('incident_services').select('status').where('incident_id', '=', id).execute()
      ).map((r) => r.status as ComponentStatus);
      await trx
        .updateTable('incidents')
        .set({
          status: latest?.status ?? input.status,
          resolved_at: resolvedAtOf(all),
          updated_at: Math.max(current.updatedAt, createdAt),
          // The impact is the worst the services got, unless set by hand.
          ...(current.impactOverride ? {} : { impact: maxImpact(current.impact, deriveImpact(statuses)) }),
        })
        .where('id', '=', id)
        .execute();
    });
    const incident = await this.get(id);
    const update = incident.updates.find((u) => u.id === updateId) as IncidentUpdateDto;
    if (notify && this.notifyIncidents) await this.#notifier.send({ kind: 'incident', incident, update });
    if (!backfill) await this.#tell({ incident, update, notify });
    return incident;
  }

  /** Edits title, impact or affected services without posting an update. */
  async update(id: string, patch: z.output<typeof incidentPatchSchema>, now = Date.now()): Promise<Incident> {
    const current = await this.get(id);
    const services = patch.services
      ? affected(patch.services, current.impact).map((s) =>
          // A bare id keeps the status the service already has in this incident.
          patch.services?.includes(s.id)
            ? { ...s, status: current.services.find((c) => c.id === s.id)?.status ?? s.status }
            : s,
        )
      : null;
    if (services) for (const s of services) this.#monitors.require(s.id);
    const statuses = (services ?? current.services).map((s) => s.status);
    await this.#db.kysely.transaction().execute(async (trx) => {
      const fields: Partial<IncidentTable> = { updated_at: Math.max(current.updatedAt, now) };
      if (patch.title !== undefined) fields.title = patch.title;
      if (patch.impact === null) {
        fields.impact_override = null;
        if (statuses.length) fields.impact = deriveImpact(statuses);
      } else if (patch.impact !== undefined) {
        fields.impact = patch.impact;
        fields.impact_override = patch.impact;
      } else if (services && !current.impactOverride) {
        fields.impact = maxImpact(current.impact, deriveImpact(statuses));
      }
      await trx.updateTable('incidents').set(fields).where('id', '=', id).execute();
      if (services) {
        await trx.deleteFrom('incident_services').where('incident_id', '=', id).execute();
        for (const s of services)
          await trx
            .insertInto('incident_services')
            .values({ incident_id: id, monitor_id: s.id, status: s.status })
            .execute();
      }
    });
    return this.get(id);
  }

  /**
   * Sets one service's status in an incident without posting an update, e.g. an automatic incident following
   * its check from down to degraded.
   */
  async setComponentStatus(id: string, monitorId: string, status: ComponentStatus): Promise<void> {
    const current = await this.get(id);
    if (current.services.find((s) => s.id === monitorId)?.status === status) return;
    await this.#db.kysely
      .insertInto('incident_services')
      .values({ incident_id: id, monitor_id: monitorId, status })
      .onConflict((oc) => oc.columns(['incident_id', 'monitor_id']).doUpdateSet({ status }))
      .execute();
    if (!current.impactOverride)
      await this.#db.kysely
        .updateTable('incidents')
        .set({ impact: maxImpact(current.impact, deriveImpact([status])) })
        .where('id', '=', id)
        .execute();
  }

  /** Saves the postmortem; publishing shows it on the incident page. */
  async setPostmortem(
    id: string,
    input: { body: string; publish: boolean; notify: boolean },
    now = Date.now(),
  ): Promise<{ incident: Incident; published: boolean }> {
    const row = await this.#db.kysely
      .selectFrom('incidents')
      .select(['postmortem_published_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`incident "${id}" not found`);
    const publishedAt = input.publish ? (row.postmortem_published_at ?? now) : null;
    await this.#db.kysely
      .updateTable('incidents')
      .set({ postmortem: input.body, postmortem_published_at: publishedAt, updated_at: now })
      .where('id', '=', id)
      .execute();
    const incident = await this.get(id, { drafts: true });
    const published = publishedAt !== null && row.postmortem_published_at === null;
    const latest = incident.updates[0];
    if (published && input.notify && latest) {
      const update = { ...latest, message: input.body, createdAt: now };
      if (this.notifyIncidents)
        await this.#notifier.send({
          kind: 'incident',
          incident,
          update: { ...update, message: `Postmortem published.\n\n${input.body}` },
        });
      await this.#tell({ incident, update, notify: true, postmortem: true });
    }
    return { incident, published };
  }

  async removePostmortem(id: string): Promise<Incident> {
    await this.get(id);
    await this.#db.kysely
      .updateTable('incidents')
      .set({ postmortem: null, postmortem_published_at: null })
      .where('id', '=', id)
      .execute();
    return this.get(id, { drafts: true });
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.#db.kysely.transaction().execute(async (trx) => {
      const updates = await trx
        .selectFrom('incident_updates')
        .select('id')
        .where('incident_id', '=', id)
        .execute();
      if (updates.length)
        await trx
          .deleteFrom('incident_update_components')
          .where(
            'update_id',
            'in',
            updates.map((u) => u.id),
          )
          .execute();
      await trx.deleteFrom('incident_updates').where('incident_id', '=', id).execute();
      await trx.deleteFrom('incident_services').where('incident_id', '=', id).execute();
      await trx.deleteFrom('incidents').where('id', '=', id).execute();
    });
  }

  /** The open automatic incident for a service, if any. */
  async openAutomatic(monitorId: string): Promise<Incident | undefined> {
    return (await this.list({ activeOnly: true, monitorId })).find((i) => i.automatic);
  }

  /** Per service: the worst status open incidents give it, which the status page shows instead of the check's. */
  async openOverrides(): Promise<Map<string, IncidentOverride>> {
    const rows = await this.#db.kysely
      .selectFrom('incident_services')
      .innerJoin('incidents', 'incidents.id', 'incident_services.incident_id')
      .select(['incident_services.monitor_id', 'incident_services.status', 'incidents.id', 'incidents.title'])
      .where('incidents.resolved_at', 'is', null)
      .orderBy('incidents.created_at', 'desc')
      .execute();
    const out = new Map<string, IncidentOverride>();
    for (const r of rows) {
      const status = r.status as ComponentStatus;
      const prev = out.get(r.monitor_id);
      if (!prev || COMPONENT_RANK[status] > COMPONENT_RANK[prev.status])
        out.set(r.monitor_id, { status, incident: { id: r.id, title: r.title } });
    }
    return out;
  }
}
