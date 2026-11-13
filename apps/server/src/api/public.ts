import type {
  AppVersion,
  AuthProviders,
  Bootstrap,
  DayState,
  Impact,
  Me,
  UrgencyLevel,
} from '@heartline/shared';
import { IMPACTS, renderMarkdown } from '@heartline/shared';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { type Vars, requireScope } from '../auth/principal.ts';
import type { AppContext } from '../context.ts';
import { APP_NAME, APP_VERSION } from '../util/pkg.ts';
import { daysParam } from './errors.ts';
import { rangeParams } from './range.ts';
import { redactDetail, redactOverview, redactService, softwareVisibility } from './visibility.ts';

const BADGE_COLORS: Record<string, string> = {
  good: '#30a14e',
  ok: '#9a6700',
  bad: '#cf222e',
  none: '#6e7781',
};

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch] as string,
  );
}

const textWidth = (t: string) => Math.round(t.length * 6.6 + 12);

export function badgeSvg(label: string, value: string, color: string): string {
  const w = textWidth;
  const lw = w(label);
  const vw = w(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">${escapeXml(label)}</text><text x="${lw + vw / 2}" y="14">${escapeXml(value)}</text></g></svg>`;
}

interface FeedItem {
  id: string;
  title: string;
  url: string;
  published: number;
  updated: number;
  /** The whole timeline as HTML. */
  html: string;
}

const statusWord = (s: string) => (s[0]?.toUpperCase() ?? '') + s.slice(1).replace('_', ' ');

/** The 50 latest incidents and 20 latest maintenance windows, most recently updated first. */
async function feedItems(app: AppContext): Promise<FeedItem[]> {
  const base = app.env.baseUrl;
  const timeline = (updates: { status: string; message: string; createdAt: number }[]) =>
    updates
      .map(
        (u) =>
          `<p><strong>${escapeXml(statusWord(u.status))}</strong> · ${new Date(u.createdAt).toUTCString()}</p>${renderMarkdown(u.message)}`,
      )
      .join('');
  const incidents = (await app.incidents.list({ limit: 50 })).map((i): FeedItem => ({
    id: i.id,
    title: `${i.title} (${statusWord(i.status)})`,
    url: `${base}/incidents/${i.id}`,
    published: i.createdAt,
    updated: i.updatedAt,
    html:
      (i.services.length ? `<p>Affected: ${escapeXml(i.services.map((s) => s.name).join(', '))}</p>` : '') +
      (i.postmortem ? `<h3>Postmortem</h3>${renderMarkdown(i.postmortem.body)}` : '') +
      timeline(i.updates),
  }));
  const maintenance = app.maintenance
    .list()
    .toSorted((a, b) => (b.updates[0]?.createdAt ?? b.startsAt) - (a.updates[0]?.createdAt ?? a.startsAt))
    .slice(0, 20)
    .map((m): FeedItem => ({
      id: m.id,
      title: `Maintenance: ${m.title} (${statusWord(m.status)})`,
      url: `${base}/maintenance/${m.id}`,
      published: m.startsAt,
      updated: m.updates[0]?.createdAt ?? m.startsAt,
      html:
        `<p>${new Date(m.nextStartsAt ?? m.startsAt).toUTCString()} – ${new Date(m.nextEndsAt ?? m.endsAt).toUTCString()}</p>` +
        (m.description ? renderMarkdown(m.description) : '') +
        timeline(m.updates),
    }));
  return [...incidents, ...maintenance].toSorted((a, b) => b.updated - a.updated);
}

export function publicRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  const readGate = requireScope('read');
  // Private status pages require any signed-in user (or a read token) for every public route.
  r.use('*', async (c, next) => (app.config().site.public ? next() : readGate(c, next)));

  const vis = (c: Context<Vars>) => softwareVisibility(c, app.config());

  const range = (c: Context<Vars>, fallback: number) => rangeParams(c, app.site().timezone, fallback);

  r.get('/overview', async (c) => {
    const { days, end } = range(c, 90);
    return c.json(redactOverview(await app.queries.overview(days, end), vis(c)));
  });

  r.get('/services/:id', async (c) => {
    const { days, end } = range(c, 30);
    return c.json(redactService(await app.queries.detail(c.req.param('id'), days, end), vis(c)));
  });

  // Software inventory: anonymous visitors never see vulnerability details, and nothing unless showVersions.
  const softwareGate: MiddlewareHandler<Vars> = async (c, next) =>
    vis(c) === 'none' ? readGate(c, next) : next();
  r.get('/software', softwareGate, async (c) => {
    const inv = await app.software.inventory();
    const v = vis(c);
    return c.json({
      ...inv,
      services: inv.services.map((s) => {
        const { vulnerabilities: _v, ...rest } = redactDetail({ ...s, vulnerabilities: [] }, v);
        return rest;
      }),
      totals:
        v === 'full'
          ? inv.totals
          : (Object.fromEntries(Object.keys(inv.totals).map((k) => [k, 0])) as Record<UrgencyLevel, number>),
    });
  });
  r.get('/software/report.csv', readGate, async (c) => {
    c.header('content-disposition', 'attachment; filename="software.csv"');
    return c.body(await app.software.csv(), 200, { 'content-type': 'text/csv; charset=utf-8' });
  });
  r.get('/services/:id/software', softwareGate, async (c) => {
    const d = await app.software.detail(c.req.param('id'));
    if (!d) return c.json({ error: 'this service has no software block' }, 404);
    return c.json(redactDetail(d, vis(c)));
  });

  /** Report file name; a range in the past carries its end day so two exports do not collide. */
  const csvName = (prefix: string, days: number, to: string | undefined) =>
    `attachment; filename="${prefix}-${days}d${to ? `-to-${to}` : ''}.csv"`;

  r.get('/services/:id/report.csv', async (c) => {
    const { days, end, to } = range(c, 90);
    c.header('content-disposition', csvName(c.req.param('id'), days, to));
    return c.body(await app.queries.csv(c.req.param('id'), days, end), 200, {
      'content-type': 'text/csv; charset=utf-8',
    });
  });

  r.get('/report.csv', async (c) => {
    const { days, end, to } = range(c, 90);
    c.header('content-disposition', csvName('status', days, to));
    return c.body(await app.queries.csv(null, days, end), 200, { 'content-type': 'text/csv; charset=utf-8' });
  });

  r.get('/incidents', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    const cursor = c.req.query('before')?.match(/^(\d+):(.+)$/);
    const impact = c.req.query('impact');
    const state = c.req.query('state');
    const list = await app.incidents.list({
      activeOnly: c.req.query('active') === 'true' || state === 'open',
      resolvedOnly: state === 'resolved',
      limit,
      before: cursor ? { createdAt: Number(cursor[1]), id: cursor[2]! } : undefined,
      search: c.req.query('q')?.trim().slice(0, 200) || undefined,
      impact: impact && (IMPACTS as readonly string[]).includes(impact) ? (impact as Impact) : undefined,
      monitorId: c.req.query('service') || undefined,
    });
    // A full page may have more behind it; the cursor names the last incident returned.
    const last = list.at(-1);
    if (list.length === limit && last) c.header('x-next-cursor', `${last.createdAt}:${last.id}`);
    return c.json(list);
  });

  r.get('/incidents/:id', async (c) => c.json(await app.incidents.get(c.req.param('id'))));

  r.get('/maintenance', (c) => {
    const state = c.req.query('state');
    return c.json(
      state === 'active' || state === 'upcoming' || state === 'past'
        ? app.maintenance.byState(state)
        : app.maintenance.list(),
    );
  });
  r.get('/maintenance/:id', (c) => c.json(app.maintenance.get(c.req.param('id'))));

  r.get('/badge/:id{.+\\.svg}', async (c) => {
    const id = c.req.param('id').replace(/\.svg$/, '');
    const days = daysParam(c.req.query('days'), 30);
    const s = (await app.queries.summaries(days)).find((x) => x.id === id);
    c.header('cache-control', 'max-age=60');
    c.header('content-type', 'image/svg+xml');
    if (!s) return c.body(badgeSvg('status', 'unknown', BADGE_COLORS.none as string), 404);
    if (c.req.query('kind') === 'version') {
      const v = vis(c);
      const sw = s.software;
      if (v === 'none' || !sw?.version)
        return c.body(badgeSvg(s.name, 'unknown', BADGE_COLORS.none as string), 404);
      const color =
        v !== 'full' || sw.urgency === 'none'
          ? BADGE_COLORS.good
          : sw.urgency === 'critical' || sw.urgency === 'high'
            ? BADGE_COLORS.bad
            : sw.urgency === 'medium' || sw.urgency === 'low'
              ? BADGE_COLORS.ok
              : BADGE_COLORS.none;
      return c.body(badgeSvg(s.name, `v${sw.version}`, color as string));
    }
    const state: DayState | 'none' =
      s.uptime === null ? 'none' : s.uptime >= 99.9 ? 'operational' : s.uptime >= 99 ? 'degraded' : 'down';
    const color =
      state === 'operational'
        ? BADGE_COLORS.good
        : state === 'degraded'
          ? BADGE_COLORS.ok
          : state === 'down'
            ? BADGE_COLORS.bad
            : BADGE_COLORS.none;
    return c.body(
      badgeSvg(s.name, s.uptime === null ? 'no data' : `${s.uptime.toFixed(2)}%`, color as string),
    );
  });

  r.get('/incidents.rss', async (c) => {
    const site = app.site();
    const base = app.env.baseUrl;
    const items = await feedItems(app);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escapeXml(site.title)} incidents and maintenance</title><link>${base}</link><description>Incident and maintenance history</description><atom:link href="${base}/api/v1/incidents.rss" rel="self" type="application/rss+xml"/>
${items
  .map(
    (i) =>
      `<item><title>${escapeXml(i.title)}</title><link>${i.url}</link><guid isPermaLink="false">${i.id}:${i.updated}</guid><pubDate>${new Date(i.updated).toUTCString()}</pubDate><description>${escapeXml(i.html)}</description></item>`,
  )
  .join('\n')}
</channel></rss>`;
    return c.body(xml, 200, { 'content-type': 'application/rss+xml; charset=utf-8' });
  });
  r.get('/incidents.atom', async (c) => {
    const site = app.site();
    const base = app.env.baseUrl;
    const items = await feedItems(app);
    const updated = new Date(Math.max(0, ...items.map((i) => i.updated)) || Date.now()).toISOString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>${escapeXml(site.title)} incidents and maintenance</title><id>${base}/</id><updated>${updated}</updated><link href="${base}"/><link rel="self" href="${base}/api/v1/incidents.atom"/><author><name>${escapeXml(site.title)}</name></author>
${items
  .map(
    (i) =>
      `<entry><id>urn:uuid:${i.id}</id><title>${escapeXml(i.title)}</title><updated>${new Date(i.updated).toISOString()}</updated><published>${new Date(i.published).toISOString()}</published><link href="${i.url}"/><content type="html">${escapeXml(i.html)}</content></entry>`,
  )
  .join('\n')}
</feed>`;
    return c.body(xml, 200, { 'content-type': 'application/atom+xml; charset=utf-8' });
  });

  return r;
}

/** Routes that must stay reachable on private pages (login page bootstrap). */
export function bootstrapRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  r.get('/site', (c) => {
    const cfg = app.config();
    const auth: AuthProviders = {
      local: cfg.auth.local,
      oidc: cfg.auth.oidc.map((p) => ({ id: p.id, name: p.name })),
    };
    const boot: Bootstrap = {
      site: app.site(),
      public: cfg.site.public,
      showVersions: cfg.site.showVersions,
      subscribe: {
        enabled: cfg.subscribers.enabled,
        email: app.subscribers.emailEnabled,
        events: app.subscribers.settings.events,
      },
      auth,
    };
    return c.json(boot);
  });
  r.get('/version', (c) => {
    const v: AppVersion = { name: APP_NAME, version: APP_VERSION, node: process.versions.node };
    return c.json(v);
  });
  r.get('/me', async (c) => {
    const p = c.get('principal');
    if (!p) return c.body(null, 204);
    const user = await app.db.kysely
      .selectFrom('user')
      .select(['image'])
      .where('id', '=', p.userId)
      .executeTakeFirst();
    const me: Me = { id: p.userId, name: p.name, email: p.email, role: p.role, image: user?.image ?? null };
    return c.json(me);
  });
  return r;
}
