import type { AuditEntryDto } from '@heartline/shared';
import type { Principal } from '../auth/principal.ts';
import type { Db } from '../db/index.ts';
import type { AuditLogTable } from '../db/schema.ts';
import { newId } from '../util/ids.ts';
import { log } from '../util/log.ts';

/** Who made a change: a signed-in user, token or MCP client, the system itself, or a status page subscriber. */
export type Actor =
  | Pick<Principal, 'userId' | 'name' | 'via'>
  | { kind: 'system'; name?: string }
  | { kind: 'subscriber'; id: string; email: string };

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

export const SYSTEM: Actor = { kind: 'system' };

const SECRET_KEYS = /pass(word)?|secret|token|hash|authorization|api[-_]?key|cookie/i;

/** Drops values under keys that look like credentials, at any depth. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) && v !== null && v !== undefined && v !== '' ? '[redacted]' : redact(v),
      ]),
    );
  return value;
}

function actorColumns(actor: Actor): Pick<AuditLogTable, 'actor_id' | 'actor_name' | 'actor_via'> {
  if ('userId' in actor) return { actor_id: actor.userId, actor_name: actor.name, actor_via: actor.via };
  if (actor.kind === 'subscriber')
    return { actor_id: actor.id, actor_name: actor.email, actor_via: 'subscriber' };
  return { actor_id: null, actor_name: actor.name ?? 'system', actor_via: 'system' };
}

export interface AuditQuery {
  limit?: number;
  /** Only entries older than this time (ms), for paging. */
  before?: number;
  entityType?: string;
  entityId?: string;
  actor?: string;
}

/** Records who changed what. Recording never fails the change itself. */
export class AuditService {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async record(actor: Actor, entry: AuditInput, now = Date.now()): Promise<void> {
    try {
      await this.#db.kysely
        .insertInto('audit_log')
        .values({
          id: newId(),
          at: now,
          ...actorColumns(actor),
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId ?? null,
          summary: entry.summary,
          detail: entry.detail ? JSON.stringify(redact(entry.detail)) : null,
          ip: entry.ip ?? null,
        })
        .execute();
    } catch (error) {
      log.error('cannot write audit log entry', { action: entry.action, error });
    }
  }

  async list(q: AuditQuery = {}): Promise<AuditEntryDto[]> {
    let query = this.#db.kysely
      .selectFrom('audit_log')
      .selectAll()
      .orderBy('at', 'desc')
      .orderBy('id', 'desc')
      .limit(Math.min(Math.max(q.limit ?? 100, 1), 500));
    if (q.before !== undefined) query = query.where('at', '<', q.before);
    if (q.entityType) query = query.where('entity_type', '=', q.entityType);
    if (q.entityId) query = query.where('entity_id', '=', q.entityId);
    if (q.actor) query = query.where('actor_name', '=', q.actor);
    const rows = await query.execute();
    return rows.map((r) => ({
      id: r.id,
      at: Number(r.at),
      actor: { id: r.actor_id, name: r.actor_name, via: r.actor_via },
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
      ip: r.ip,
    }));
  }

  /** Deletes entries older than `days`; returns how many. */
  async prune(days: number, now = Date.now()): Promise<number> {
    const res = await this.#db.kysely
      .deleteFrom('audit_log')
      .where('at', '<', now - days * 86_400_000)
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }
}
