import type { Maintenance, ServiceRef } from '@heartline/shared';
import { maintenanceCreateSchema } from '@heartline/shared';
// rrule is CommonJS: Node exposes it only as a default export.
// oxlint-disable-next-line import/default
import rrulePkg from 'rrule';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import { newId } from '../util/ids.ts';
import type { MonitorService } from './monitors.ts';
import { NotFoundError } from './monitors.ts';

const { RRule } = rrulePkg;

interface Window {
  id: string;
  title: string;
  description: string | null;
  startsAt: number;
  endsAt: number;
  recurrence: string | null;
  services: string[];
}

function toIcsDate(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function parseRecurrence(startsAt: number, recurrence: string): InstanceType<typeof RRule> {
  const rule = recurrence.replace(/^RRULE:/i, '');
  return RRule.fromString(`DTSTART:${toIcsDate(startsAt)}\nRRULE:${rule}`);
}

/** The occurrence active at `at`, or the next one after it. */
export function occurrence(
  w: Pick<Window, 'startsAt' | 'endsAt' | 'recurrence'>,
  at: number,
): { start: number; end: number } | null {
  const length = w.endsAt - w.startsAt;
  if (!w.recurrence) return w.endsAt > at ? { start: w.startsAt, end: w.endsAt } : null;
  const rule = parseRecurrence(w.startsAt, w.recurrence);
  const next = rule.after(new Date(at - length), true);
  return next ? { start: next.getTime(), end: next.getTime() + length } : null;
}

export class MaintenanceService {
  #db: Db;
  #monitors: MonitorService;
  #windows: Window[] = [];

  constructor(db: Db, monitors: MonitorService) {
    this.#db = db;
    this.#monitors = monitors;
  }

  async reload(): Promise<void> {
    const db = this.#db.kysely;
    const rows = await db.selectFrom('maintenances').selectAll().orderBy('starts_at').execute();
    const links = await db.selectFrom('maintenance_services').selectAll().execute();
    this.#windows = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      recurrence: r.recurrence,
      services: links.filter((l) => l.maintenance_id === r.id).map((l) => l.monitor_id),
    }));
  }

  isActive(monitorId: string, at = Date.now()): boolean {
    return this.#windows.some((w) => {
      if (w.services.length && !w.services.includes(monitorId)) return false;
      const occ = occurrence(w, at);
      return occ !== null && occ.start <= at && at < occ.end;
    });
  }

  #dto(w: Window, now: number): Maintenance {
    const occ = occurrence(w, now);
    const services: ServiceRef[] = w.services.map((id) => ({ id, name: this.#monitors.get(id)?.name ?? id }));
    return {
      id: w.id,
      title: w.title,
      description: w.description,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      recurrence: w.recurrence,
      nextStartsAt: occ?.start ?? null,
      nextEndsAt: occ?.end ?? null,
      active: occ !== null && occ.start <= now && now < occ.end,
      services,
    };
  }

  list(now = Date.now()): Maintenance[] {
    return this.#windows
      .map((w) => this.#dto(w, now))
      .toSorted((a, b) => (a.nextStartsAt ?? Infinity) - (b.nextStartsAt ?? Infinity));
  }

  /** Active and future windows starting within `horizonMs`. */
  upcoming(now = Date.now(), horizonMs = 30 * 86_400_000): Maintenance[] {
    return this.list(now).filter((m) => m.nextStartsAt !== null && m.nextStartsAt < now + horizonMs);
  }

  async create(input: z.output<typeof maintenanceCreateSchema>, author: string | null): Promise<Maintenance> {
    if (input.recurrence) parseRecurrence(input.startsAt.getTime(), input.recurrence);
    for (const s of input.services) this.#monitors.require(s);
    const id = newId();
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .insertInto('maintenances')
        .values({
          id,
          title: input.title,
          description: input.description ?? null,
          starts_at: input.startsAt.getTime(),
          ends_at: input.endsAt.getTime(),
          recurrence: input.recurrence ?? null,
          created_at: Date.now(),
          created_by: author,
        })
        .execute();
      for (const s of input.services)
        await trx.insertInto('maintenance_services').values({ maintenance_id: id, monitor_id: s }).execute();
    });
    await this.reload();
    return this.get(id);
  }

  get(id: string): Maintenance {
    const w = this.#windows.find((x) => x.id === id);
    if (!w) throw new NotFoundError(`maintenance "${id}" not found`);
    return this.#dto(w, Date.now());
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx.deleteFrom('maintenance_services').where('maintenance_id', '=', id).execute();
      await trx.deleteFrom('maintenances').where('id', '=', id).execute();
    });
    await this.reload();
  }
}
