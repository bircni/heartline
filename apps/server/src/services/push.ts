import type { CheckStatus, MonitorSpec } from '@heartline/shared';
import { formatDuration } from '@heartline/shared';
import type { CheckOutcome } from '../checks/types.ts';
import type { Db } from '../db/index.ts';
import { randomToken, sha256 } from '../util/ids.ts';
import type { LoadedMonitor, MonitorService } from './monitors.ts';
import { ValidationError } from './monitors.ts';

type PushSpec = Extract<MonitorSpec, { type: 'push' }>;

export interface PushInfo {
  /** First characters of the token, to recognise the URL. */
  prefix: string;
  lastPushAt: number | null;
  lastPushStatus: string | null;
}

/** Status words of heartbeat pings, Alertmanager, Grafana and the like. */
const ALIASES: Record<string, CheckStatus> = {
  up: 'up',
  ok: 'up',
  resolved: 'up',
  operational: 'up',
  success: 'up',
  healthy: 'up',
  degraded: 'degraded',
  warning: 'degraded',
  warn: 'degraded',
  pending: 'degraded',
  down: 'down',
  firing: 'down',
  alerting: 'down',
  critical: 'down',
  error: 'down',
  fail: 'down',
  failed: 'down',
  maintenance: 'maintenance',
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Reads a push: `status` or `state` (aliases above, default up), a message from `msg`, `message`,
 * `summary` or an Alertmanager `commonAnnotations.summary`, `latencyMs` (or `ping`) and `version`. Query
 * parameters and a JSON body both work; the body wins.
 */
export function parsePush(query: Record<string, string>, body: unknown): CheckOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const annotations = (b.commonAnnotations ?? {}) as Record<string, unknown>;
  const raw = (str(b.status) ?? str(b.state) ?? query.status ?? query.state ?? 'up').toLowerCase();
  const status = ALIASES[raw];
  if (!status) throw new ValidationError(`unknown status "${raw}"`);
  const message =
    str(b.msg) ??
    str(b.message) ??
    str(b.summary) ??
    str(annotations.summary) ??
    str(annotations.description) ??
    str(b.title) ??
    query.msg ??
    query.message ??
    null;
  const latencyRaw = b.latencyMs ?? b.ping ?? query.latencyMs ?? query.ping;
  const latency = latencyRaw === undefined ? null : Number(latencyRaw);
  const version = str(b.version) ?? query.version;
  return {
    status,
    latencyMs: latency !== null && Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : null,
    message: message ? message.slice(0, 500) : null,
    ...(version ? { version: version.slice(0, 100) } : {}),
  };
}

/** Secret push URLs of push monitors, and the watchdog that notices missing heartbeats. */
export class PushService {
  readonly #db: Db;
  readonly #monitors: MonitorService;

  constructor(db: Db, monitors: MonitorService) {
    this.#db = db;
    this.#monitors = monitors;
  }

  /** A new secret for a monitor's push URL; the old one stops working. Returned once, stored hashed. */
  async rotate(monitorId: string, now = Date.now()): Promise<string> {
    const m = this.#monitors.require(monitorId);
    if (m.spec.type !== 'push') throw new ValidationError('only push monitors have a push URL');
    const token = `hlp_${randomToken(24)}`;
    await this.#store(monitorId, token, now);
    return token;
  }

  async #store(monitorId: string, token: string, now: number): Promise<void> {
    const row = { token_hash: sha256(token), prefix: token.slice(0, 10), created_at: now };
    await this.#db.kysely
      .insertInto('monitor_push')
      .values({ monitor_id: monitorId, ...row, last_push_at: null, last_push_status: null })
      .onConflict((oc) => oc.column('monitor_id').doUpdateSet(row))
      .execute();
  }

  /** Stores the `token` of push monitors from status.yaml, so their fixed URL works. */
  async syncConfigTokens(now = Date.now()): Promise<void> {
    const rows = await this.#db.kysely
      .selectFrom('monitor_push')
      .select(['monitor_id', 'token_hash'])
      .execute();
    for (const m of this.#monitors.list()) {
      if (m.source !== 'config' || m.spec.type !== 'push' || !m.spec.token) continue;
      const hash = sha256(m.spec.token);
      if (rows.find((r) => r.monitor_id === m.id)?.token_hash !== hash)
        await this.#store(m.id, m.spec.token, now);
    }
  }

  /** The monitor a push URL belongs to. */
  async resolve(token: string): Promise<LoadedMonitor | null> {
    if (!token.startsWith('hlp_') && token.length < 24) return null;
    const row = await this.#db.kysely
      .selectFrom('monitor_push')
      .select('monitor_id')
      .where('token_hash', '=', sha256(token))
      .executeTakeFirst();
    const m = row ? this.#monitors.get(row.monitor_id) : undefined;
    return m?.spec.type === 'push' ? m : null;
  }

  async touch(monitorId: string, status: CheckStatus, at = Date.now()): Promise<void> {
    await this.#db.kysely
      .updateTable('monitor_push')
      .set({ last_push_at: at, last_push_status: status })
      .where('monitor_id', '=', monitorId)
      .execute();
  }

  async info(monitorIds: string[]): Promise<Map<string, PushInfo>> {
    if (monitorIds.length === 0) return new Map();
    const rows = await this.#db.kysely
      .selectFrom('monitor_push')
      .selectAll()
      .where('monitor_id', 'in', monitorIds)
      .execute();
    return new Map(
      rows.map((r) => [
        r.monitor_id,
        { prefix: r.prefix, lastPushAt: r.last_push_at, lastPushStatus: r.last_push_status },
      ]),
    );
  }

  /**
   * What a heartbeat monitor looks like now: down once a heartbeat is overdue (`interval + grace` since the
   * last one, or since the monitor was created when none came yet). `record` is false while heartbeats are on
   * time, since each push was already recorded as the check.
   */
  async watchdog(
    monitor: LoadedMonitor,
    now = Date.now(),
  ): Promise<{ outcome: CheckOutcome; record: boolean }> {
    const spec = monitor.spec as PushSpec;
    const [row, created] = await Promise.all([
      this.#db.kysely
        .selectFrom('monitor_push')
        .select('last_push_at')
        .where('monitor_id', '=', monitor.id)
        .executeTakeFirst(),
      this.#db.kysely
        .selectFrom('monitors')
        .select('created_at')
        .where('id', '=', monitor.id)
        .executeTakeFirst(),
    ]);
    const last = row?.last_push_at ?? null;
    const since = last ?? created?.created_at ?? now;
    const overdue = now - since > spec.interval + spec.grace;
    if (!overdue)
      return {
        outcome: {
          status: last ? 'up' : 'unknown',
          latencyMs: null,
          message: last
            ? `last heartbeat ${formatDuration(Math.max(1000, now - last))} ago`
            : 'waiting for the first heartbeat',
        },
        record: false,
      };
    return {
      outcome: {
        status: 'down',
        latencyMs: null,
        message: last
          ? `no heartbeat for ${formatDuration(now - last)} (expected every ${formatDuration(spec.interval)})`
          : `no heartbeat yet (expected every ${formatDuration(spec.interval)})`,
      },
      record: true,
    };
  }
}
