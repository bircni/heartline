import type { CheckStatus, ServiceStatus, UpstreamIssue } from '@heartline/shared';
import { sql } from 'kysely';
import type { CheckOutcome } from '../checks/types.ts';
import type { Db } from '../db/index.ts';
import type { NotifierService } from '../notify/index.ts';
import type { IncidentService } from '../services/incidents.ts';
import { type AuditService, SYSTEM } from '../services/audit.ts';
import type { MaintenanceService } from '../services/maintenance.ts';
import type { LoadedMonitor } from '../services/monitors.ts';
import { log } from '../util/log.ts';
import { dayKey } from '@heartline/shared';
import { dayRange } from '../util/time.ts';

export interface EngineSettings {
  timezone: string;
  recoveryNotifications: boolean;
  reminderEveryMs: number;
}

export interface Transition {
  from: ServiceStatus;
  to: ServiceStatus;
}

/** Pure state machine: next status after a check, given the threshold of consecutive failures. */
export function nextState(
  prev: { status: ServiceStatus; failures: number },
  result: CheckStatus,
  threshold: number,
  inMaintenance: boolean,
): { status: ServiceStatus; failures: number } {
  // An unreadable status says nothing about the service: keep the failure count, show unknown.
  if (result === 'unknown')
    return { status: inMaintenance ? 'maintenance' : 'unknown', failures: prev.failures };
  const failures = result === 'up' || result === 'maintenance' ? 0 : prev.failures + 1;
  if (inMaintenance || result === 'maintenance') return { status: 'maintenance', failures };
  if (result === 'up') return { status: 'operational', failures };
  if (failures >= threshold) return { status: result === 'down' ? 'down' : 'degraded', failures };
  // Below threshold: keep what users see, except leaving maintenance or the very first checks.
  const keep = prev.status === 'maintenance' || prev.status === 'paused' ? 'unknown' : prev.status;
  return { status: keep, failures };
}

export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number;
}

const SERVICE_STATUS: Record<CheckStatus, ServiceStatus> = {
  up: 'operational',
  degraded: 'degraded',
  down: 'down',
  maintenance: 'maintenance',
  unknown: 'unknown',
};

const LABEL: Record<ServiceStatus, string> = {
  operational: 'operational',
  degraded: 'degraded',
  partial: 'partly down',
  down: 'down',
  maintenance: 'in maintenance',
  paused: 'paused',
  unknown: 'unknown',
};

/** Appends the dependencies that are not operational to a status message. */
export function withUpstream(message: string | null, upstream: UpstreamIssue[]): string | null {
  if (!upstream.length) return message;
  const cause = `Likely cause: ${upstream.map((u) => `${u.name} is ${LABEL[u.status]}`).join(', ')}.`;
  return message ? `${message}\n${cause}` : cause;
}

export class StatusEngine {
  #db: Db;
  #notifier: NotifierService;
  #incidents: IncidentService;
  #maintenance: MaintenanceService;
  settings: EngineSettings = { timezone: 'UTC', recoveryNotifications: true, reminderEveryMs: 0 };
  /** Dependencies of a monitor that are not operational; set by the app. */
  upstream: (monitor: LoadedMonitor) => Promise<UpstreamIssue[]> = async () => [];
  /** Records automatic incidents in the audit log. */
  audit: AuditService | null = null;

  constructor(
    db: Db,
    notifier: NotifierService,
    incidents: IncidentService,
    maintenance: MaintenanceService,
  ) {
    this.#db = db;
    this.#notifier = notifier;
    this.#incidents = incidents;
    this.#maintenance = maintenance;
  }

  async record(monitor: LoadedMonitor, outcome: CheckOutcome, at = Date.now()): Promise<Transition | null> {
    const db = this.#db.kysely;
    const inMaintenance = this.#maintenance.isActive(monitor.id, at);
    const prevRow = await db
      .selectFrom('monitor_state')
      .selectAll()
      .where('monitor_id', '=', monitor.id)
      .executeTakeFirst();
    const prev = {
      status: (prevRow?.status ?? 'unknown') as ServiceStatus,
      failures: prevRow?.consecutive_failures ?? 0,
    };
    const next = nextState(prev, outcome.status, monitor.spec.failureThreshold, inMaintenance);
    const changed = next.status !== prev.status;
    const day = dayKey(at, this.settings.timezone);
    const latency = outcome.latencyMs;
    const counted = inMaintenance ? 'maintenance' : outcome.status;
    // Unreadable results are kept as raw checks but count neither for nor against uptime.
    const rollup = counted !== 'unknown';

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('check_results')
        .values({
          monitor_id: monitor.id,
          checked_at: at,
          status: outcome.status,
          latency_ms: latency,
          message: outcome.message,
        })
        .onConflict((oc) => oc.columns(['monitor_id', 'checked_at']).doNothing())
        .execute();
      const inc = {
        checks: 1,
        up: counted === 'up' ? 1 : 0,
        degraded: counted === 'degraded' ? 1 : 0,
        down: counted === 'down' ? 1 : 0,
        maintenance: counted === 'maintenance' ? 1 : 0,
        latency_sum: latency ?? 0,
        latency_count: latency === null ? 0 : 1,
        latency_max: latency ?? 0,
      };
      if (rollup)
        await trx
          .insertInto('daily_rollups')
          .values({ monitor_id: monitor.id, day, ...inc, latency_p95: null })
          .onConflict((oc) =>
            oc.columns(['monitor_id', 'day']).doUpdateSet((eb) => ({
              checks: eb('daily_rollups.checks', '+', inc.checks),
              up: eb('daily_rollups.up', '+', inc.up),
              degraded: eb('daily_rollups.degraded', '+', inc.degraded),
              down: eb('daily_rollups.down', '+', inc.down),
              maintenance: eb('daily_rollups.maintenance', '+', inc.maintenance),
              latency_sum: eb('daily_rollups.latency_sum', '+', inc.latency_sum),
              latency_count: eb('daily_rollups.latency_count', '+', inc.latency_count),
              latency_max: sql<number>`case when ${eb.ref('daily_rollups.latency_max')} > ${inc.latency_max} then ${eb.ref('daily_rollups.latency_max')} else ${inc.latency_max} end`,
            })),
          )
          .execute();
      const state = {
        status: next.status,
        since: changed ? at : (prevRow?.since ?? at),
        consecutive_failures: next.failures,
        last_checked_at: at,
        last_status: outcome.status,
        last_latency_ms: latency,
        last_message: outcome.message,
      };
      await trx
        .insertInto('monitor_state')
        .values({ monitor_id: monitor.id, ...state, last_notified_at: prevRow?.last_notified_at ?? null })
        .onConflict((oc) => oc.column('monitor_id').doUpdateSet(state))
        .execute();
    });

    if (changed) {
      log.info('status changed', {
        service: monitor.id,
        from: prev.status,
        to: next.status,
        message: outcome.message,
      });
      // After a spell of unreadable results, compare with the last status that was actually read.
      const from =
        prev.status === 'unknown' && prevRow?.last_status === 'unknown'
          ? await this.#lastKnown(monitor.id, at)
          : prev.status;
      if (from !== next.status) await this.#onTransition(monitor, from, next.status, outcome, at);
      return { from: prev.status, to: next.status };
    }
    await this.#maybeRemind(
      monitor,
      next.status,
      prevRow?.since ?? at,
      prevRow?.last_notified_at ?? null,
      outcome,
      at,
    );
    return null;
  }

  async #lastKnown(monitorId: string, before: number): Promise<ServiceStatus> {
    const row = await this.#db.kysely
      .selectFrom('check_results')
      .select('status')
      .where('monitor_id', '=', monitorId)
      .where('checked_at', '<', before)
      .where('status', '!=', 'unknown')
      .orderBy('checked_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? SERVICE_STATUS[row.status as CheckStatus] : 'unknown';
  }

  async #onTransition(
    monitor: LoadedMonitor,
    from: ServiceStatus,
    to: ServiceStatus,
    outcome: CheckOutcome,
    at: number,
  ): Promise<void> {
    const quiet =
      to === 'maintenance' ||
      from === 'maintenance' ||
      to === 'paused' ||
      from === 'paused' ||
      to === 'unknown';
    const firstCheck = from === 'unknown' && to === 'operational';
    const recovery = to === 'operational';
    const bad = to === 'down' || to === 'degraded';
    const service = { id: monitor.id, name: monitor.name };
    const message = bad ? withUpstream(outcome.message, await this.#upstreamOf(monitor)) : outcome.message;

    if (
      !quiet &&
      !firstCheck &&
      (bad || (recovery && this.settings.recoveryNotifications && from !== 'unknown'))
    ) {
      await this.#notifier.send({ kind: 'status', service, from, to, message, at }, monitor.spec.notify);
      await this.#db.kysely
        .updateTable('monitor_state')
        .set({ last_notified_at: at })
        .where('monitor_id', '=', monitor.id)
        .execute();
    }

    if (!monitor.spec.autoIncident) return;
    try {
      const open = await this.#incidents.openAutomatic(monitor.id);
      if (to === 'down' && !open) {
        // No impact given: it follows the service, major while down.
        const incident = await this.#incidents.create(
          {
            title: `${monitor.name} is unavailable`,
            status: 'investigating',
            message: `Automatic checks are failing: ${message ?? 'no details'}.`,
            services: [{ id: monitor.id, status: 'down' }],
            notify: false,
          },
          null,
          true,
        );
        await this.audit?.record(SYSTEM, {
          action: 'incident.auto_open',
          entityType: 'incident',
          entityId: incident.id,
          summary: `Opened “${incident.title}” because ${monitor.name} is down`,
          detail: { monitor: monitor.id },
        });
      } else if (open && (to === 'down' || to === 'degraded')) {
        // The open automatic incident follows the service between down and degraded.
        await this.#incidents.setComponentStatus(open.id, monitor.id, to);
      } else if (recovery && open) {
        await this.#incidents.addUpdate(
          open.id,
          { status: 'resolved', message: 'Automatic checks are passing again.', notify: false },
          null,
        );
        await this.audit?.record(SYSTEM, {
          action: 'incident.auto_resolve',
          entityType: 'incident',
          entityId: open.id,
          summary: `Resolved the automatic incident of ${monitor.name}`,
          detail: { monitor: monitor.id },
        });
      }
    } catch (error) {
      log.error('automatic incident handling failed', { service: monitor.id, error });
    }
  }

  async #upstreamOf(monitor: LoadedMonitor): Promise<UpstreamIssue[]> {
    if (!monitor.spec.dependsOn.length) return [];
    try {
      return await this.upstream(monitor);
    } catch (error) {
      log.warn('could not read upstream status', { service: monitor.id, error });
      return [];
    }
  }

  async #maybeRemind(
    monitor: LoadedMonitor,
    status: ServiceStatus,
    since: number,
    lastNotified: number | null,
    outcome: CheckOutcome,
    at: number,
  ): Promise<void> {
    const every = this.settings.reminderEveryMs;
    if (!every || status !== 'down') return;
    if (at - (lastNotified ?? since) < every) return;
    await this.#notifier.send(
      {
        kind: 'status',
        service: { id: monitor.id, name: monitor.name },
        from: 'down',
        to: 'down',
        message: withUpstream(outcome.message, await this.#upstreamOf(monitor)),
        at,
        reminder: true,
      },
      monitor.spec.notify,
    );
    await this.#db.kysely
      .updateTable('monitor_state')
      .set({ last_notified_at: at })
      .where('monitor_id', '=', monitor.id)
      .execute();
  }

  /** Recomputes p95 latency for the given days from raw results (raw data must still exist). */
  async refreshPercentiles(days: string[]): Promise<void> {
    const db = this.#db.kysely;
    for (const day of days) {
      const [start, end] = dayRange(day, this.settings.timezone);
      const rows = await db
        .selectFrom('check_results')
        .select(['monitor_id', 'latency_ms'])
        .where('checked_at', '>=', start)
        .where('checked_at', '<', end)
        .where('latency_ms', 'is not', null)
        .execute();
      const byMonitor = new Map<string, number[]>();
      for (const r of rows) {
        const list = byMonitor.get(r.monitor_id) ?? [];
        list.push(r.latency_ms as number);
        byMonitor.set(r.monitor_id, list);
      }
      for (const [monitorId, values] of byMonitor) {
        await db
          .updateTable('daily_rollups')
          .set({ latency_p95: p95(values) })
          .where('monitor_id', '=', monitorId)
          .where('day', '=', day)
          .execute();
      }
    }
  }

  async pruneRawResults(retentionDays: number, now = Date.now()): Promise<number> {
    const res = await this.#db.kysely
      .deleteFrom('check_results')
      .where('checked_at', '<', now - retentionDays * 86_400_000)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  async setPausedState(monitorId: string, paused: boolean): Promise<void> {
    const now = Date.now();
    const status: ServiceStatus = paused ? 'paused' : 'unknown';
    await this.#db.kysely
      .insertInto('monitor_state')
      .values({
        monitor_id: monitorId,
        status,
        since: now,
        consecutive_failures: 0,
        last_checked_at: null,
        last_status: null,
        last_latency_ms: null,
        last_message: null,
        last_notified_at: null,
      })
      .onConflict((oc) =>
        oc.column('monitor_id').doUpdateSet({ status, since: now, consecutive_failures: 0 }),
      )
      .execute();
  }
}
