/**
 * Starts heartline with example history: 90 days of daily rollups, 7 days of raw checks,
 * past incidents and upcoming maintenance. Live checks continue on top of the seeded data.
 *
 *   pnpm --filter @heartline/server demo
 */
import { serve } from '@hono/node-server';
import { createApp } from '../src/app.ts';
import { bootstrap } from '../src/bootstrap.ts';
import { loadConfig } from '../src/config/load.ts';
import { readEnv } from '../src/env.ts';
import type { Db } from '../src/db/index.ts';
import { p95 } from '../src/status/engine.ts';
import { newId } from '../src/util/ids.ts';
import { log } from '../src/util/log.ts';
import { dayKey } from '@heartline/shared';
import { dayRange, lastDays } from '../src/util/time.ts';

const DAY = 86_400_000;

/** Deterministic pseudo-random numbers so the demo looks the same on every run. */
function rng(initial: number) {
  let s = initial;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const BASE_LATENCY: Record<string, number> = {
  github: 180,
  npm: 90,
  ghcr: 60,
  example: 120,
  wikipedia: 140,
  dns: 12,
  'local-api': 2,
  backups: 900,
};
/** Bad days per service: days ago → state. */
const EVENTS: Record<string, Record<number, 'degraded' | 'down'>> = {
  github: { 41: 'degraded', 12: 'down' },
  npm: { 63: 'degraded' },
  example: { 4: 'degraded', 27: 'degraded' },
  wikipedia: { 19: 'down', 20: 'degraded' },
  dns: { 52: 'degraded' },
  backups: { 35: 'down' },
};

async function seed(db: Db, ids: string[], timezone: string, now: number) {
  const k = db.kysely;
  if (await k.selectFrom('daily_rollups').select('monitor_id').limit(1).executeTakeFirst()) {
    log.info('demo data already present, skipping seed');
    return;
  }
  const days = lastDays(90, now, timezone).slice(0, -1); // today fills up from live checks
  for (const id of ids) {
    const rand = rng(id.length * 7919 + id.charCodeAt(0));
    const base = BASE_LATENCY[id] ?? 100;
    const events = EVENTS[id] ?? {};
    const rows = days.map((day, i) => {
      const ago = days.length - i;
      const state = events[ago];
      const checks = 1440;
      const down = state === 'down' ? Math.round(30 + rand() * 60) : 0;
      const degraded = state === 'degraded' ? Math.round(120 + rand() * 200) : Math.round(rand() * 3);
      const avg = Math.round(base * (0.9 + rand() * 0.25) * (state === 'degraded' ? 2.2 : 1));
      return {
        monitor_id: id,
        day,
        checks,
        up: checks - down - degraded,
        degraded,
        down,
        maintenance: 0,
        latency_sum: avg * (checks - down),
        latency_count: checks - down,
        latency_max: Math.round(avg * 4),
        latency_p95: Math.round(avg * (1.5 + rand() * 0.4)),
      };
    });
    for (let i = 0; i < rows.length; i += 50)
      await k
        .insertInto('daily_rollups')
        .values(rows.slice(i, i + 50))
        .execute();

    // Raw results every 10 minutes for the last 7 days (fine-grained charts and recent checks).
    const raw = [];
    for (let at = now - 7 * DAY; at < now - 60_000; at += 10 * 60_000) {
      const hour = new Date(at).getUTCHours();
      const wave = 1 + 0.25 * Math.sin(((hour - 6) / 24) * 2 * Math.PI);
      const ago = Math.floor((now - at) / DAY) + 1;
      const slow = events[ago] === 'degraded';
      raw.push({
        monitor_id: id,
        checked_at: at,
        status: slow ? 'degraded' : 'up',
        latency_ms: Math.round(base * wave * (0.85 + rand() * 0.3) * (slow ? 2.2 : 1)),
        message: slow ? 'slow response' : 'ok',
      });
    }
    for (let i = 0; i < raw.length; i += 200)
      await k
        .insertInto('check_results')
        .values(raw.slice(i, i + 200))
        .execute();

    // Today's rollup and p95 from the raw rows, so the bar for today is consistent with the chart.
    const today = dayKey(now, timezone);
    const [start] = dayRange(today, timezone);
    const todays = raw.filter((r) => r.checked_at >= start);
    if (todays.length) {
      await k
        .insertInto('daily_rollups')
        .values({
          monitor_id: id,
          day: today,
          checks: todays.length,
          up: todays.filter((r) => r.status === 'up').length,
          degraded: todays.filter((r) => r.status === 'degraded').length,
          down: 0,
          maintenance: 0,
          latency_sum: todays.reduce((a, r) => a + r.latency_ms, 0),
          latency_count: todays.length,
          latency_max: Math.max(...todays.map((r) => r.latency_ms)),
          latency_p95: p95(todays.map((r) => r.latency_ms)),
        })
        .execute();
    }
  }

  const incident = async (
    svc: string,
    title: string,
    impact: string,
    daysAgo: number,
    updates: [number, string, string][],
  ) => {
    const id = newId();
    const start = now - daysAgo * DAY;
    const resolved = updates.some(([, s]) => s === 'resolved')
      ? start + Math.max(...updates.map(([m]) => m)) * 60_000
      : null;
    await k
      .insertInto('incidents')
      .values({
        id,
        title,
        status: updates.at(-1)?.[1] ?? 'investigating',
        impact,
        automatic: 0,
        created_at: start,
        updated_at: start + Math.max(0, ...updates.map(([m]) => m)) * 60_000,
        resolved_at: resolved,
        created_by: 'Demo Admin',
        impact_override: null,
        postmortem: null,
        postmortem_published_at: null,
      })
      .execute();
    await k
      .insertInto('incident_services')
      .values({
        incident_id: id,
        monitor_id: svc,
        status: impact === 'major' ? 'down' : impact === 'partial' ? 'partial' : 'degraded',
      })
      .execute();
    for (const [min, status, message] of updates) {
      await k
        .insertInto('incident_updates')
        .values({
          id: newId(),
          incident_id: id,
          status,
          message,
          created_at: start + min * 60_000,
          author: 'Demo Admin',
          notify: 0,
        })
        .execute();
    }
  };
  await incident('github', 'Git operations failing', 'major', 12, [
    [0, 'investigating', 'Pushes and clones fail with HTTP 502 for some users.'],
    [18, 'identified', 'An upstream load balancer is dropping connections.'],
    [41, 'monitoring', 'Traffic was shifted to healthy nodes. Error rates are back to normal.'],
    [65, 'resolved', 'Git operations have been stable for 20 minutes.'],
  ]);
  await incident('wikipedia', 'Pages loading slowly', 'partial', 19, [
    [0, 'investigating', 'Page loads take more than five seconds in Europe.'],
    [35, 'identified', 'A cache cluster is overloaded after a deploy.'],
    [95, 'resolved', 'The deploy was rolled back and latency is normal again.'],
  ]);
  await incident('backups', 'Nightly backup missed', 'degraded', 35, [
    [0, 'investigating', 'The backup-age plugin reports the newest snapshot is 31 hours old.'],
    [310, 'resolved', 'A manual run completed. Snapshots are current again.'],
  ]);
  await incident('example', 'Elevated response times', 'degraded', 4, [
    [0, 'investigating', 'Responses are about twice as slow as usual.'],
    [52, 'resolved', 'Response times recovered after a CDN configuration fix.'],
  ]);

  const nextSunday = new Date(now);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + ((7 - nextSunday.getUTCDay()) % 7 || 7));
  nextSunday.setUTCHours(1, 0, 0, 0);
  await k
    .insertInto('maintenances')
    .values({
      id: newId(),
      title: 'Postgres 18.1 minor upgrade',
      description: 'Write operations may pause for a few seconds.',
      starts_at: nextSunday.getTime(),
      ends_at: nextSunday.getTime() + 30 * 60_000,
      recurrence: null,
      created_at: now,
      created_by: 'Demo Admin',
      status: 'scheduled',
      started_at: null,
      completed_at: null,
    })
    .execute();
  await k
    .insertInto('maintenances')
    .values({
      id: newId(),
      title: 'Node OS updates (rolling)',
      description: 'No downtime expected.',
      starts_at: nextSunday.getTime() + 2 * 3_600_000,
      ends_at: nextSunday.getTime() + 3 * 3_600_000,
      recurrence: 'FREQ=WEEKLY;BYDAY=SU',
      created_at: now,
      created_by: 'Demo Admin',
      status: 'scheduled',
      started_at: null,
      completed_at: null,
    })
    .execute();
  log.info('seeded demo history', { services: ids.length, days: 90 });
}

const env = readEnv();
const config = await loadConfig(env.configPath);
const runtime = await bootstrap({ env, config, devOrigins: ['http://localhost:5173'] });
await seed(
  runtime.db,
  runtime.monitors.list().map((m) => m.id),
  config.site.timezone,
  Date.now(),
);
await runtime.maintenance.reload();
const app = createApp(runtime);
serve({ fetch: app.fetch, port: env.port, hostname: env.host }, () =>
  log.info('demo running', { url: env.baseUrl }),
);
await runtime.start();
