import type { Maintenance, MaintenanceStatus, MaintenanceUpdateDto, ServiceRef } from '@heartline/shared';
import type {
  maintenanceCreateSchema,
  maintenanceUpdateCreateSchema,
  maintenanceUpdateSchema,
} from '@heartline/shared';
// rrule is CommonJS: Node exposes it only as a default export.
// oxlint-disable-next-line import/default
import rrulePkg from 'rrule';
import type { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { NotifierService } from '../notify/index.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/log.ts';
import { type AuditService, SYSTEM } from './audit.ts';
import type { MonitorService } from './monitors.ts';
import { ConflictError, NotFoundError } from './monitors.ts';

const { RRule } = rrulePkg;

/** A start or end noticed this much later (e.g. after downtime) is recorded without notifying. */
const LATE_MS = 15 * 60_000;

export type MaintenanceEventKind = 'scheduled' | 'reminder' | 'started' | 'completed' | 'update';

export interface MaintenanceEvent {
  kind: MaintenanceEventKind;
  maintenance: Maintenance;
  /** The occurrence it is about (its start); the window's start for one-off windows. */
  occurrence: number;
  /** The update text, for `update`; otherwise a standard sentence. */
  message: string;
  at: number;
}

interface Window {
  id: string;
  title: string;
  description: string | null;
  startsAt: number;
  endsAt: number;
  recurrence: string | null;
  services: string[];
  status: MaintenanceStatus;
  startedAt: number | null;
  completedAt: number | null;
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

/** The latest occurrence that started at or before `at`. */
function lastStarted(w: Window, at: number): { start: number; end: number } | null {
  const length = w.endsAt - w.startsAt;
  if (!w.recurrence) return w.startsAt <= at ? { start: w.startsAt, end: w.endsAt } : null;
  const prev = parseRecurrence(w.startsAt, w.recurrence).before(new Date(at), true);
  return prev ? { start: prev.getTime(), end: prev.getTime() + length } : null;
}

const SENTENCE: Record<Exclude<MaintenanceEventKind, 'update'>, string> = {
  scheduled: 'Maintenance is scheduled.',
  reminder: 'Maintenance starts soon.',
  started: 'Maintenance is in progress.',
  completed: 'Maintenance is completed.',
};

export class MaintenanceService {
  #db: Db;
  #monitors: MonitorService;
  #notifier: NotifierService | null;
  #windows: Window[] = [];
  #updates: (MaintenanceUpdateDto & { maintenanceId: string })[] = [];
  #occurrences = new Map<string, { startedAt: number | null; completedAt: number | null }>();
  /** Lead time of the reminder; 0 sends none. */
  reminderBeforeMs = 3_600_000;
  /** Whether the ops channels hear about maintenance. */
  notifyChannels = true;
  /** Records automatic transitions in the audit log. */
  audit: AuditService | null = null;
  /** Further listeners (subscriber e-mails). Failures are logged, never thrown. */
  readonly listeners: ((e: MaintenanceEvent) => Promise<void>)[] = [];

  constructor(db: Db, monitors: MonitorService, notifier: NotifierService | null = null) {
    this.#db = db;
    this.#monitors = monitors;
    this.#notifier = notifier;
  }

  async reload(now = Date.now()): Promise<void> {
    const db = this.#db.kysely;
    const [rows, links, updates, occurrences] = await Promise.all([
      db.selectFrom('maintenances').selectAll().orderBy('starts_at').execute(),
      db.selectFrom('maintenance_services').selectAll().execute(),
      db.selectFrom('maintenance_updates').selectAll().orderBy('created_at', 'desc').execute(),
      db
        .selectFrom('maintenance_occurrences')
        .selectAll()
        .where('occurrence_start', '>=', now - 60 * 86_400_000)
        .execute(),
    ]);
    this.#windows = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      recurrence: r.recurrence,
      services: links.filter((l) => l.maintenance_id === r.id).map((l) => l.monitor_id),
      status: r.status as MaintenanceStatus,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    }));
    this.#updates = updates.map((u) => ({
      id: u.id,
      maintenanceId: u.maintenance_id,
      status: u.status as MaintenanceStatus,
      message: u.message,
      createdAt: u.created_at,
      author: u.author,
    }));
    this.#occurrences = new Map(
      occurrences.map((o) => [
        `${o.maintenance_id}:${o.occurrence_start}`,
        { startedAt: o.started_at, completedAt: o.completed_at },
      ]),
    );
  }

  /** Whether `at` is within a window covering the service. */
  isActive(monitorId: string, at = Date.now()): boolean {
    return this.#windows.some((w) => {
      if (w.services.length && !w.services.includes(monitorId)) return false;
      return this.#activeAt(w, at);
    });
  }

  #activeAt(w: Window, at: number): boolean {
    if (!w.recurrence) {
      // A one-off window can start early or end early by hand; until the leader records the start, the
      // schedule decides, so a lagging replica still shows it.
      if (w.status === 'in_progress' || w.status === 'verifying')
        return at < w.endsAt || w.completedAt === null;
      return w.status === 'scheduled' && w.startsAt <= at && at < w.endsAt;
    }
    const occ = occurrence(w, at);
    return occ !== null && occ.start <= at && at < occ.end;
  }

  #dto(w: Window, now: number): Maintenance {
    const occ = occurrence(w, now);
    const services: ServiceRef[] = w.services.map((id) => ({ id, name: this.#monitors.get(id)?.name ?? id }));
    const active = this.#activeAt(w, now);
    let status = w.status;
    let startedAt = w.startedAt;
    let completedAt = w.completedAt;
    if (w.recurrence) {
      const o = occ ? this.#occurrences.get(`${w.id}:${occ.start}`) : undefined;
      status = !occ ? 'completed' : active ? 'in_progress' : 'scheduled';
      startedAt = o?.startedAt ?? (active && occ ? occ.start : null);
      completedAt = null;
    } else if (active && status === 'scheduled') {
      status = 'in_progress';
      startedAt = w.startsAt;
    }
    return {
      id: w.id,
      title: w.title,
      description: w.description,
      startsAt: w.startsAt,
      endsAt: w.endsAt,
      recurrence: w.recurrence,
      nextStartsAt: occ?.start ?? null,
      nextEndsAt: occ?.end ?? null,
      active,
      status,
      startedAt,
      completedAt,
      updates: this.#updates
        .filter((u) => u.maintenanceId === w.id)
        .slice(0, w.recurrence ? 10 : undefined)
        .map(({ maintenanceId: _m, ...u }) => u),
      services,
    };
  }

  /** Every window, the next to start first. */
  list(now = Date.now()): Maintenance[] {
    return this.#windows
      .map((w) => this.#dto(w, now))
      .toSorted((a, b) => (a.nextStartsAt ?? Infinity) - (b.nextStartsAt ?? Infinity));
  }

  /** Active and future windows starting within `horizonMs`. */
  upcoming(now = Date.now(), horizonMs = 30 * 86_400_000): Maintenance[] {
    return this.list(now).filter(
      (m) => m.status !== 'completed' && m.nextStartsAt !== null && m.nextStartsAt < now + horizonMs,
    );
  }

  /** Windows by state: running now, still to come, or over (newest first). */
  byState(state: 'active' | 'upcoming' | 'past', now = Date.now()): Maintenance[] {
    const all = this.list(now);
    if (state === 'active') return all.filter((m) => m.active);
    if (state === 'upcoming')
      return all.filter((m) => !m.active && m.status === 'scheduled' && m.nextStartsAt !== null);
    return all.filter((m) => m.status === 'completed').toSorted((a, b) => b.endsAt - a.endsAt);
  }

  get(id: string, now = Date.now()): Maintenance {
    const w = this.#windows.find((x) => x.id === id);
    if (!w) throw new NotFoundError(`maintenance "${id}" not found`);
    return this.#dto(w, now);
  }

  async create(
    input: z.output<typeof maintenanceCreateSchema>,
    author: string | null,
    now = Date.now(),
  ): Promise<Maintenance> {
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
          created_at: now,
          created_by: author,
          status: 'scheduled',
          started_at: null,
          completed_at: null,
        })
        .execute();
      for (const s of input.services)
        await trx.insertInto('maintenance_services').values({ maintenance_id: id, monitor_id: s }).execute();
    });
    await this.reload(now);
    const m = this.get(id, now);
    if (input.notify && input.endsAt.getTime() > now)
      await this.#emit({
        kind: 'scheduled',
        maintenance: m,
        occurrence: m.nextStartsAt ?? m.startsAt,
        message: SENTENCE.scheduled,
        at: now,
      });
    return m;
  }

  async update(
    id: string,
    patch: z.output<typeof maintenanceUpdateSchema>,
    now = Date.now(),
  ): Promise<Maintenance> {
    const w = this.#windows.find((x) => x.id === id);
    if (!w) throw new NotFoundError(`maintenance "${id}" not found`);
    const startsAt = patch.startsAt?.getTime() ?? w.startsAt;
    const endsAt = patch.endsAt?.getTime() ?? w.endsAt;
    if (endsAt <= startsAt) throw new ConflictError('endsAt must be after startsAt');
    const recurrence = patch.recurrence === undefined ? w.recurrence : patch.recurrence;
    if (recurrence) parseRecurrence(startsAt, recurrence);
    if (patch.services) for (const s of patch.services) this.#monitors.require(s);
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .updateTable('maintenances')
        .set({
          title: patch.title ?? w.title,
          description: patch.description === undefined ? w.description : patch.description,
          starts_at: startsAt,
          ends_at: endsAt,
          recurrence,
          // Moving a completed one-off window into the future schedules it again.
          ...(!recurrence && w.status === 'completed' && endsAt > now
            ? { status: 'scheduled', started_at: null, completed_at: null }
            : {}),
        })
        .where('id', '=', id)
        .execute();
      if (patch.services) {
        await trx.deleteFrom('maintenance_services').where('maintenance_id', '=', id).execute();
        for (const s of new Set(patch.services))
          await trx
            .insertInto('maintenance_services')
            .values({ maintenance_id: id, monitor_id: s })
            .execute();
      }
    });
    await this.reload(now);
    return this.get(id, now);
  }

  /** Posts a status update on a one-off window, e.g. "verifying" or an early "completed". */
  async addUpdate(
    id: string,
    input: z.output<typeof maintenanceUpdateCreateSchema>,
    author: string | null,
    now = Date.now(),
  ): Promise<Maintenance> {
    const w = this.#windows.find((x) => x.id === id);
    if (!w) throw new NotFoundError(`maintenance "${id}" not found`);
    if (w.recurrence) throw new ConflictError('recurring windows start and complete automatically');
    if (w.status === 'completed') throw new ConflictError('this maintenance is completed');
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx
        .insertInto('maintenance_updates')
        .values({
          id: newId(),
          maintenance_id: id,
          status: input.status,
          message: input.message,
          created_at: now,
          author,
          notify: input.notify ? 1 : 0,
        })
        .execute();
      await trx
        .updateTable('maintenances')
        .set({
          status: input.status,
          started_at: input.status === 'scheduled' ? null : (w.startedAt ?? now),
          completed_at: input.status === 'completed' ? now : null,
        })
        .where('id', '=', id)
        .execute();
      // The tick must not announce a start that was posted by hand.
      if (input.status !== 'scheduled')
        await trx
          .insertInto('maintenance_occurrences')
          .values({
            maintenance_id: id,
            occurrence_start: w.startsAt,
            reminded_at: now,
            started_at: w.startedAt ?? now,
            completed_at: input.status === 'completed' ? now : null,
          })
          .onConflict((oc) =>
            oc.columns(['maintenance_id', 'occurrence_start']).doUpdateSet({
              started_at: w.startedAt ?? now,
              completed_at: input.status === 'completed' ? now : null,
            }),
          )
          .execute();
    });
    await this.reload(now);
    const m = this.get(id, now);
    if (input.notify)
      await this.#emit({
        kind: 'update',
        maintenance: m,
        occurrence: w.startsAt,
        message: input.message,
        at: now,
      });
    return m;
  }

  async remove(id: string, now = Date.now()): Promise<void> {
    this.get(id, now);
    await this.#db.kysely.transaction().execute(async (trx) => {
      await trx.deleteFrom('maintenance_services').where('maintenance_id', '=', id).execute();
      await trx.deleteFrom('maintenance_updates').where('maintenance_id', '=', id).execute();
      await trx.deleteFrom('maintenance_occurrences').where('maintenance_id', '=', id).execute();
      await trx.deleteFrom('maintenances').where('id', '=', id).execute();
    });
    await this.reload(now);
  }

  /**
   * Moves windows along their schedule: reminders, starts and ends. Runs on the leader; every transition is
   * claimed with a conditional write, so a second leader for a moment or a restart never repeats one.
   */
  async tick(now = Date.now()): Promise<void> {
    await this.reload(now);
    let changed = false;
    for (const w of this.#windows) {
      try {
        changed = (await this.#tickWindow(w, now)) || changed;
      } catch (error) {
        log.error('maintenance tick failed', { maintenance: w.id, error });
      }
    }
    if (changed) await this.reload(now);
  }

  async #tickWindow(w: Window, now: number): Promise<boolean> {
    const db = this.#db.kysely;
    let changed = false;
    const claim = async (
      start: number,
      column: 'reminded_at' | 'started_at' | 'completed_at',
      guard?: 'started_at',
    ) => {
      await db
        .insertInto('maintenance_occurrences')
        .values({
          maintenance_id: w.id,
          occurrence_start: start,
          reminded_at: null,
          started_at: null,
          completed_at: null,
        })
        .onConflict((oc) => oc.columns(['maintenance_id', 'occurrence_start']).doNothing())
        .execute();
      let q = db
        .updateTable('maintenance_occurrences')
        .set({ [column]: now })
        .where('maintenance_id', '=', w.id)
        .where('occurrence_start', '=', start)
        .where(column, 'is', null);
      if (guard) q = q.where(guard, 'is not', null);
      return Number((await q.executeTakeFirst()).numUpdatedRows) > 0;
    };
    const record = async (status: MaintenanceStatus, message: string, notify: boolean) => {
      await db
        .insertInto('maintenance_updates')
        .values({
          id: newId(),
          maintenance_id: w.id,
          status,
          message,
          created_at: now,
          author: null,
          notify: notify ? 1 : 0,
        })
        .execute();
      await this.audit?.record(SYSTEM, {
        action: status === 'completed' ? 'maintenance.auto_complete' : 'maintenance.auto_start',
        entityType: 'maintenance',
        entityId: w.id,
        summary: `${status === 'completed' ? 'Completed' : 'Started'} maintenance “${w.title}” on schedule`,
      });
    };
    const emit = async (kind: Exclude<MaintenanceEventKind, 'update'>, occ: number, notify: boolean) => {
      if (!notify) return;
      await this.reload(now);
      await this.#emit({
        kind,
        maintenance: this.get(w.id, now),
        occurrence: occ,
        message: SENTENCE[kind],
        at: now,
      });
    };

    // Reminder before the next start.
    const next = occurrence(w, now);
    if (
      this.reminderBeforeMs > 0 &&
      next &&
      next.start > now &&
      next.start - this.reminderBeforeMs <= now &&
      (w.recurrence || w.status === 'scheduled') &&
      (await claim(next.start, 'reminded_at'))
    ) {
      changed = true;
      await emit('reminder', next.start, true);
    }

    const last = lastStarted(w, now);
    if (!last) return changed;
    const lateStart = now - last.start > LATE_MS;
    const lateEnd = now - last.end > LATE_MS;

    if (!w.recurrence) {
      if (w.status === 'completed') return changed;
      if (now < last.end && w.status === 'scheduled') {
        const res = await db
          .updateTable('maintenances')
          .set({ status: 'in_progress', started_at: now })
          .where('id', '=', w.id)
          .where('status', '=', 'scheduled')
          .executeTakeFirst();
        if (Number(res.numUpdatedRows) > 0 && (await claim(last.start, 'started_at'))) {
          await record('in_progress', SENTENCE.started, !lateStart);
          await emit('started', last.start, !lateStart);
          changed = true;
        }
      }
      if (now >= last.end) {
        // Always completed at the planned end, also while verifying.
        const res = await db
          .updateTable('maintenances')
          .set({ status: 'completed', completed_at: last.end, started_at: w.startedAt ?? last.start })
          .where('id', '=', w.id)
          .where('status', '!=', 'completed')
          .executeTakeFirst();
        if (Number(res.numUpdatedRows) > 0) {
          await claim(last.start, 'completed_at');
          await record('completed', SENTENCE.completed, !lateEnd);
          await emit('completed', last.start, !lateEnd);
          changed = true;
        }
      }
      return changed;
    }

    // Recurring: the latest occurrence starts, and ends once its time is up (only if it was started).
    if (now < last.end) {
      if (await claim(last.start, 'started_at')) {
        await record('in_progress', SENTENCE.started, !lateStart);
        await emit('started', last.start, !lateStart);
        changed = true;
      }
    } else if (await claim(last.start, 'completed_at', 'started_at')) {
      await record('completed', SENTENCE.completed, !lateEnd);
      await emit('completed', last.start, !lateEnd);
      changed = true;
    }
    return changed;
  }

  async #emit(event: MaintenanceEvent): Promise<void> {
    if (this.notifyChannels && this.#notifier) {
      try {
        await this.#notifier.send({
          kind: 'maintenance',
          maintenance: event.maintenance,
          event: event.kind,
          message: event.message,
          at: event.at,
        });
      } catch (error) {
        log.error('maintenance notification failed', { error });
      }
    }
    for (const l of this.listeners) {
      try {
        await l(event);
      } catch (error) {
        log.error('maintenance listener failed', { error });
      }
    }
  }
}
