import { Hono } from 'hono';
import { type Vars, requireScope } from '../auth/principal.ts';
import type { AppContext } from '../context.ts';
import * as sp from '../statuspage/map.ts';
import { sha256 } from '../util/ids.ts';

/**
 * The Statuspage public API v2 (`summary.json`, `status.json`, `components.json`, `incidents*.json`,
 * `scheduled-maintenances*.json`), so Statuspage widgets and aggregators read this page as well.
 */
export function statuspageRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  const gate = requireScope('read');
  r.use('*', async (c, next) => (app.config().site.public ? next() : gate(c, next)));

  // One snapshot serves all endpoints for a few seconds; widgets poll them often.
  let cache: { at: number; data: Promise<Snapshot> } | null = null;
  const snapshot = (): Promise<Snapshot> => {
    const now = Date.now();
    if (!cache || now - cache.at > 10_000) {
      cache = { at: now, data: build(app, now) };
      cache.data.catch(() => {
        cache = null;
      });
    }
    return cache.data;
  };

  r.use('*', async (c, next) => {
    await next();
    c.header('cache-control', app.config().site.public ? 'public, max-age=30' : 'private, max-age=30');
  });
  r.get('/summary.json', async (c) => {
    const s = await snapshot();
    return c.json({
      page: s.page,
      status: s.status,
      components: s.components,
      incidents: s.incidents.filter((i) => i.resolved_at === null),
      scheduled_maintenances: s.maintenances.filter((m) => m.status !== 'completed'),
    });
  });
  r.get('/status.json', async (c) => {
    const s = await snapshot();
    return c.json({ page: s.page, status: s.status });
  });
  r.get('/components.json', async (c) => {
    const s = await snapshot();
    return c.json({ page: s.page, components: s.components });
  });
  r.get('/incidents.json', async (c) => {
    const s = await snapshot();
    return c.json({ page: s.page, incidents: s.incidents });
  });
  r.get('/incidents/unresolved.json', async (c) => {
    const s = await snapshot();
    return c.json({ page: s.page, incidents: s.incidents.filter((i) => i.resolved_at === null) });
  });
  r.get('/scheduled-maintenances.json', async (c) => {
    const s = await snapshot();
    return c.json({ page: s.page, scheduled_maintenances: s.maintenances });
  });
  r.get('/scheduled-maintenances/upcoming.json', async (c) => {
    const s = await snapshot();
    return c.json({
      page: s.page,
      scheduled_maintenances: s.maintenances.filter((m) => m.status === 'scheduled'),
    });
  });
  r.get('/scheduled-maintenances/active.json', async (c) => {
    const s = await snapshot();
    return c.json({
      page: s.page,
      scheduled_maintenances: s.maintenances.filter(
        (m) => m.status === 'in_progress' || m.status === 'verifying',
      ),
    });
  });
  return r;
}

interface Snapshot {
  page: sp.SpPage;
  status: { indicator: sp.SpIndicator; description: string };
  components: sp.SpComponent[];
  incidents: sp.SpIncident[];
  maintenances: sp.SpIncident[];
}

async function build(app: AppContext, now: number): Promise<Snapshot> {
  const base = app.env.baseUrl;
  const pageId = sha256(base).slice(0, 12);
  const [overview, incidents, rows, states] = await Promise.all([
    app.queries.overview(1, now, now),
    app.incidents.list({ limit: 50 }),
    app.db.kysely.selectFrom('monitors').select(['id', 'created_at']).execute(),
    app.db.kysely.selectFrom('monitor_state').select(['monitor_id', 'since']).execute(),
  ]);
  const times: sp.ComponentTimes = {
    created: new Map(rows.map((r) => [r.id, r.created_at])),
    changed: new Map(states.map((s) => [s.monitor_id, s.since])),
  };
  const components = sp.components(overview.groups, pageId, times);
  const byId = new Map(components.map((c) => [c.id, c]));
  const windows = app.maintenance
    .list(now)
    .toSorted((a, b) => (b.nextStartsAt ?? b.startsAt) - (a.nextStartsAt ?? a.startsAt))
    .slice(0, 50);
  const mapped = {
    incidents: incidents.map((i) => sp.incident(i, pageId, base, byId)),
    maintenances: windows.map((m) => sp.maintenance(m, pageId, base, byId)),
  };
  const updated = Math.max(
    0,
    ...components.map((c) => Date.parse(c.updated_at)),
    ...mapped.incidents.map((i) => Date.parse(i.updated_at)),
    ...mapped.maintenances.map((m) => Date.parse(m.updated_at)),
  );
  const site = app.site();
  return {
    page: {
      id: pageId,
      name: site.title,
      url: base,
      time_zone: site.timezone,
      updated_at: new Date(updated || now).toISOString(),
    },
    status: sp.pageStatus(overview),
    components,
    ...mapped,
  };
}
