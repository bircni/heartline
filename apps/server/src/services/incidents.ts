import type { Impact, Incident, IncidentStatus, IncidentUpdateDto } from '@heartline/shared';
import type { incidentCreateSchema, incidentUpdateCreateSchema } from '@heartline/shared';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { NotifierService } from '../notify/index.ts';
import { newId } from '../util/ids.ts';
import { type MonitorService, NotFoundError } from './monitors.ts';

export class IncidentService {
  #db: Db;
  #monitors: MonitorService;
  #notifier: NotifierService;
  notifyIncidents = true;

  constructor(db: Db, monitors: MonitorService, notifier: NotifierService) {
    this.#db = db;
    this.#monitors = monitors;
    this.#notifier = notifier;
  }

  async #hydrate(
    rows: {
      id: string;
      title: string;
      status: string;
      impact: string;
      automatic: number;
      created_at: number;
      resolved_at: number | null;
    }[],
  ): Promise<Incident[]> {
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
        .execute(),
    ]);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as IncidentStatus,
      impact: r.impact as Impact,
      automatic: Boolean(r.automatic),
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      services: links
        .filter((l) => l.incident_id === r.id)
        .map((l) => ({ id: l.monitor_id, name: this.#monitors.get(l.monitor_id)?.name ?? l.monitor_id })),
      updates: updates
        .filter((u) => u.incident_id === r.id)
        .map((u): IncidentUpdateDto => ({
          id: u.id,
          status: u.status as IncidentStatus,
          message: u.message,
          createdAt: u.created_at,
          author: u.author,
        })),
    }));
  }

  async list(
    opts: { activeOnly?: boolean; since?: number; monitorId?: string; limit?: number } = {},
  ): Promise<Incident[]> {
    let q = this.#db.kysely
      .selectFrom('incidents')
      .selectAll('incidents')
      .orderBy('incidents.created_at', 'desc');
    if (opts.activeOnly) q = q.where('incidents.resolved_at', 'is', null);
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
    if (opts.monitorId) {
      q = q
        .innerJoin('incident_services', 'incident_services.incident_id', 'incidents.id')
        .where('incident_services.monitor_id', '=', opts.monitorId);
    }
    if (opts.limit) q = q.limit(opts.limit);
    return this.#hydrate(await q.execute());
  }

  async get(id: string): Promise<Incident> {
    const row = await this.#db.kysely
      .selectFrom('incidents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`incident "${id}" not found`);
    return (await this.#hydrate([row]))[0] as Incident;
  }

  async create(
    input: z.output<typeof incidentCreateSchema>,
    author: string | null,
    automatic = false,
  ): Promise<Incident> {
    for (const s of input.services) this.#monitors.require(s);
    const id = newId();
    const now = Date.now();
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .insertInto('incidents')
        .values({
          id,
          title: input.title,
          status: input.status,
          impact: input.impact,
          automatic: automatic ? 1 : 0,
          created_at: now,
          resolved_at: input.status === 'resolved' ? now : null,
          created_by: author,
        })
        .execute();
      for (const s of input.services)
        await trx.insertInto('incident_services').values({ incident_id: id, monitor_id: s }).execute();
      await trx
        .insertInto('incident_updates')
        .values({
          id: newId(),
          incident_id: id,
          status: input.status,
          message: input.message,
          created_at: now,
          author,
        })
        .execute();
    });
    const incident = await this.get(id);
    if (input.notify && this.notifyIncidents)
      await this.#notifier.send({
        kind: 'incident',
        incident,
        update: incident.updates[0] as IncidentUpdateDto,
      });
    return incident;
  }

  async addUpdate(
    id: string,
    input: z.output<typeof incidentUpdateCreateSchema>,
    author: string | null,
  ): Promise<Incident> {
    const current = await this.get(id);
    const now = Date.now();
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .insertInto('incident_updates')
        .values({
          id: newId(),
          incident_id: id,
          status: input.status,
          message: input.message,
          created_at: now,
          author,
        })
        .execute();
      await trx
        .updateTable('incidents')
        .set({
          status: input.status,
          resolved_at: input.status === 'resolved' ? (current.resolvedAt ?? now) : null,
        })
        .where('id', '=', id)
        .execute();
    });
    const incident = await this.get(id);
    if (input.notify && this.notifyIncidents)
      await this.#notifier.send({
        kind: 'incident',
        incident,
        update: incident.updates[0] as IncidentUpdateDto,
      });
    return incident;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx.deleteFrom('incident_updates').where('incident_id', '=', id).execute();
      await trx.deleteFrom('incident_services').where('incident_id', '=', id).execute();
      await trx.deleteFrom('incidents').where('id', '=', id).execute();
    });
  }

  /** The open automatic incident for a service, if any. */
  async openAutomatic(monitorId: string): Promise<Incident | undefined> {
    return (await this.list({ activeOnly: true, monitorId })).find((i) => i.automatic);
  }
}
