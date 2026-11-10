import type {
  CheckResultDto,
  CheckStatus,
  DayBar,
  DayState,
  LatencyPoint,
  Overview,
  ServiceDetail,
  ServiceStatus,
  ServiceSummary,
  SiteInfo,
  SoftwareSummary,
} from '@heartline/shared';
import { sql } from 'kysely';
import { describeTarget } from '../checks/index.ts';
import type { Db } from '../db/index.ts';
import type { DailyRollupTable } from '../db/schema.ts';
import { dayRange, lastDays } from '../util/time.ts';
import type { IncidentService } from './incidents.ts';
import type { MaintenanceService } from './maintenance.ts';
import type { LoadedMonitor, MonitorService } from './monitors.ts';

type Rollup = Omit<DailyRollupTable, 'monitor_id'>;

export function dayState(
  r: Pick<Rollup, 'checks' | 'maintenance' | 'down' | 'degraded'> | undefined,
): DayState {
  if (!r || r.checks === 0) return 'nodata';
  const counted = r.checks - r.maintenance;
  if (counted <= 0) return 'maintenance';
  const downRatio = r.down / counted;
  if (downRatio >= 0.02) return 'down';
  if (r.down > 0 || r.degraded / counted >= 0.05) return 'degraded';
  return 'operational';
}

/** Uptime in percent; degraded counts as up, maintenance is excluded. */
export function uptimeOf(rows: Rollup[]): number | null {
  let counted = 0;
  let good = 0;
  for (const r of rows) {
    const c = r.checks - r.maintenance;
    counted += c;
    good += c - r.down;
  }
  return counted > 0 ? Math.round((good / counted) * 10_000) / 100 : null;
}

function bar(day: string, r: Rollup | undefined): DayBar {
  return {
    day,
    state: dayState(r),
    uptime: r ? uptimeOf([r]) : null,
    avgLatencyMs: r && r.latency_count ? Math.round(r.latency_sum / r.latency_count) : null,
    p95LatencyMs: r?.latency_p95 ?? null,
    checks: r?.checks ?? 0,
  };
}

const SEVERITY: Record<ServiceStatus, number> = {
  down: 5,
  degraded: 4,
  maintenance: 3,
  unknown: 1,
  paused: 0,
  operational: 0,
};

export interface QueryDeps {
  db: Db;
  monitors: MonitorService;
  incidents: IncidentService;
  maintenance: MaintenanceService;
  site: () => SiteInfo;
  rawRetentionDays: () => number;
  /** Software summaries per monitor id; routes redact them per viewer. */
  software: () => Promise<Map<string, SoftwareSummary>>;
  security: () => Promise<{ critical: number; high: number }>;
}

export class QueryService {
  #d: QueryDeps;
  constructor(deps: QueryDeps) {
    this.#d = deps;
  }

  async #rollups(ids: string[], days: string[]): Promise<Map<string, Map<string, Rollup>>> {
    const out = new Map<string, Map<string, Rollup>>();
    if (!ids.length || !days.length) return out;
    const rows = await this.#d.db.kysely
      .selectFrom('daily_rollups')
      .selectAll()
      .where('monitor_id', 'in', ids)
      .where('day', '>=', days[0] as string)
      .where('day', '<=', days.at(-1) as string)
      .execute();
    for (const r of rows) {
      const m = out.get(r.monitor_id) ?? new Map<string, Rollup>();
      m.set(r.day, r);
      out.set(r.monitor_id, m);
    }
    return out;
  }

  async #states(ids: string[]) {
    if (!ids.length) return new Map();
    const rows = await this.#d.db.kysely
      .selectFrom('monitor_state')
      .selectAll()
      .where('monitor_id', 'in', ids)
      .execute();
    return new Map(rows.map((r) => [r.monitor_id, r]));
  }

  #statusOf(m: LoadedMonitor, stored: string | undefined, now: number): ServiceStatus {
    if (m.paused) return 'paused';
    if (this.#d.maintenance.isActive(m.id, now)) return 'maintenance';
    return (stored as ServiceStatus | undefined) ?? 'unknown';
  }

  /** Services with their bars for the `daysCount` days ending with the day of `end`. */
  async summaries(daysCount: number, end = Date.now(), now = Date.now()): Promise<ServiceSummary[]> {
    const monitors = this.#d.monitors.list();
    const ids = monitors.map((m) => m.id);
    const days = lastDays(daysCount, end, this.#d.site().timezone);
    const [rollups, states, software] = await Promise.all([
      this.#rollups(ids, days),
      this.#states(ids),
      this.#d.software(),
    ]);
    return monitors.map((m) => {
      const byDay = rollups.get(m.id) ?? new Map<string, Rollup>();
      return {
        id: m.id,
        name: m.name,
        group: m.group,
        kind: m.spec.type,
        status: this.#statusOf(m, states.get(m.id)?.status, now),
        uptime: uptimeOf([...byDay.values()]),
        bars: days.map((d) => bar(d, byDay.get(d))),
        software: software.get(m.id) ?? null,
      };
    });
  }

  /** The current state of every service, with history for the `daysCount` days ending with the day of `end`. */
  async overview(daysCount: number, end = Date.now(), now = Date.now()): Promise<Overview> {
    const services = await this.summaries(daysCount, end, now);
    const activeIncidents = await this.#d.incidents.list({ activeOnly: true });
    const relevant = services.filter((s) => s.status !== 'paused');
    const worst = relevant.reduce<ServiceStatus>(
      (acc, s) => (SEVERITY[s.status] > SEVERITY[acc] ? s.status : acc),
      'operational',
    );
    const operational = relevant.filter((s) => s.status === 'operational').length;
    const affected = relevant.filter((s) => s.status === 'down' || s.status === 'degraded');
    const majorIncident = activeIncidents.some((i) => i.impact === 'major');
    const status: ServiceStatus = majorIncident && SEVERITY[worst] < SEVERITY.down ? 'down' : worst;

    const headline =
      relevant.length === 0
        ? 'No services configured'
        : status === 'operational'
          ? 'All systems operational'
          : status === 'down'
            ? affected.length > 1 || majorIncident
              ? 'Major outage'
              : 'Partial outage'
            : status === 'degraded'
              ? 'Partially degraded'
              : status === 'maintenance'
                ? 'Scheduled maintenance in progress'
                : 'Checking services';
    const names = affected.map((s) => s.name);
    const summary =
      names.length === 0
        ? `${operational} of ${relevant.length} services are operational.`
        : `${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} affected. ${operational} of ${relevant.length} services are operational.`;

    const groups = this.#d.monitors
      .groups()
      .map((name) => ({ name, services: services.filter((s) => s.group === name) }));
    return {
      site: this.#d.site(),
      status,
      headline,
      summary: activeIncidents[0] ? `${activeIncidents[0].title}. ${summary}` : summary,
      operational,
      total: relevant.length,
      days: daysCount,
      groups,
      activeIncidents,
      upcomingMaintenance: this.#d.maintenance.upcoming(now),
      security: await this.#d.security(),
      generatedAt: now,
    };
  }

  /** The current state of a service, with history for the `daysCount` days ending with the day of `end`. */
  async detail(id: string, daysCount: number, end = Date.now(), now = Date.now()): Promise<ServiceDetail> {
    const m = this.#d.monitors.require(id);
    const days = lastDays(daysCount, end, this.#d.site().timezone);
    const [rollups, states, software, checks] = await Promise.all([
      this.#rollups([id], days),
      this.#states([id]),
      this.#d.software(),
      this.#d.db.kysely
        .selectFrom('check_results')
        .selectAll()
        .where('monitor_id', '=', id)
        .orderBy('checked_at', 'desc')
        .limit(25)
        .execute(),
    ]);
    const byDay = rollups.get(id) ?? new Map<string, Rollup>();
    const rows = [...byDay.values()];
    const latencyCount = rows.reduce((a, r) => a + r.latency_count, 0);
    const p95s = rows.map((r) => r.latency_p95).filter((v): v is number => v !== null);
    const since = end - daysCount * 86_400_000;
    const incidents = await this.#d.incidents.list({ monitorId: id, since, until: end, limit: 50 });
    const state = states.get(id);
    const bars = days.map((d) => bar(d, byDay.get(d)));
    const series = await this.#series(id, daysCount, bars, end, now);
    return {
      id: m.id,
      name: m.name,
      group: m.group,
      kind: m.spec.type,
      description: m.spec.description ?? null,
      status: this.#statusOf(m, state?.status, now),
      target: describeTarget(m.spec),
      intervalMs: m.spec.interval,
      lastCheckedAt: state?.last_checked_at ?? null,
      uptime: uptimeOf(rows),
      bars,
      software: software.get(id) ?? null,
      days: daysCount,
      kpis: {
        uptime: uptimeOf(rows),
        avgLatencyMs: latencyCount
          ? Math.round(rows.reduce((a, r) => a + r.latency_sum, 0) / latencyCount)
          : null,
        p95LatencyMs: p95s.length ? Math.max(...p95s) : null,
        incidents: incidents.length,
      },
      checks: checks.map((c): CheckResultDto => ({
        at: c.checked_at,
        status: c.status as CheckStatus,
        latencyMs: c.latency_ms,
        message: c.message,
      })),
      incidents,
      series: series.points,
      seriesBucketMs: series.bucketMs,
      rangeStart: dayRange(days[0] as string, this.#d.site().timezone)[0],
      rangeEnd: end,
      generatedAt: now,
    };
  }

  /**
   * Fine-grained latency from raw results while they are retained (about 240 buckets), otherwise
   * one point per day from the rollups.
   */
  async #series(
    id: string,
    daysCount: number,
    bars: DayBar[],
    end: number,
    now: number,
  ): Promise<{ points: LatencyPoint[]; bucketMs: number }> {
    const span = daysCount * 86_400_000;
    // Raw results only reach back `rawRetentionDays` from now, so older ranges use the daily rollups.
    if (now - (end - span) > this.#d.rawRetentionDays() * 86_400_000) {
      return {
        points: bars.map((b) => ({
          at: Date.parse(`${b.day}T12:00:00Z`),
          avgLatencyMs: b.avgLatencyMs,
          highLatencyMs: b.p95LatencyMs,
          state: null,
          checks: null,
          down: null,
        })),
        bucketMs: 86_400_000,
      };
    }
    const bucketMs = Math.max(60_000, Math.ceil(span / 240 / 60_000) * 60_000);
    const db = this.#d.db.kysely;
    const [rows, failed] = await Promise.all([
      db
        .selectFrom('check_results')
        .select([
          sql<number>`checked_at / ${sql.lit(bucketMs)}`.as('bucket'),
          sql<number | null>`avg(latency_ms)`.as('avg'),
          sql<number | null>`max(latency_ms)`.as('high'),
          sql<number>`count(*)`.as('checks'),
        ])
        .where('monitor_id', '=', id)
        .where('checked_at', '>=', end - span)
        .where('checked_at', '<=', end)
        .groupBy(sql`checked_at / ${sql.lit(bucketMs)}`)
        .orderBy('bucket')
        .execute(),
      // Few rows: maintenance is not stored per check, so failures are replayed against the windows.
      db
        .selectFrom('check_results')
        .select(['checked_at', 'status'])
        .where('monitor_id', '=', id)
        .where('checked_at', '>=', end - span)
        .where('checked_at', '<=', end)
        .where('status', '!=', 'up')
        .execute(),
    ]);
    const counts = new Map<number, { down: number; degraded: number; maintenance: number }>();
    for (const f of failed) {
      const key = Math.floor(f.checked_at / bucketMs);
      const c = counts.get(key) ?? { down: 0, degraded: 0, maintenance: 0 };
      if (this.#d.maintenance.isActive(id, f.checked_at)) c.maintenance++;
      else if (f.status === 'down') c.down++;
      else c.degraded++;
      counts.set(key, c);
    }
    return {
      points: rows.map((r) => {
        const c = counts.get(Number(r.bucket)) ?? { down: 0, degraded: 0, maintenance: 0 };
        const checks = Number(r.checks);
        return {
          at: Number(r.bucket) * bucketMs + bucketMs / 2,
          avgLatencyMs: r.avg === null ? null : Math.round(Number(r.avg)),
          highLatencyMs: r.high === null ? null : Number(r.high),
          state: dayState({ checks, ...c }),
          checks,
          down: c.down,
        };
      }),
      bucketMs,
    };
  }

  /** Daily report for the `daysCount` days ending with the day of `end`. */
  async csv(id: string | null, daysCount: number, end = Date.now()): Promise<string> {
    const monitors = id ? [this.#d.monitors.require(id)] : this.#d.monitors.list();
    const days = lastDays(daysCount, end, this.#d.site().timezone);
    const rollups = await this.#rollups(
      monitors.map((m) => m.id),
      days,
    );
    const lines = [
      'service,day,state,uptime_percent,checks,up,degraded,down,maintenance,avg_latency_ms,p95_latency_ms',
    ];
    for (const m of monitors) {
      const byDay = rollups.get(m.id) ?? new Map<string, Rollup>();
      for (const d of days) {
        const r = byDay.get(d);
        const b = bar(d, r);
        lines.push(
          [
            m.id,
            d,
            b.state,
            b.uptime ?? '',
            r?.checks ?? 0,
            r?.up ?? 0,
            r?.degraded ?? 0,
            r?.down ?? 0,
            r?.maintenance ?? 0,
            b.avgLatencyMs ?? '',
            b.p95LatencyMs ?? '',
          ].join(','),
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }
}
