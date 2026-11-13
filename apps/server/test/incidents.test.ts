import type { Incident, Overview, ServiceDetail, TemplateDto } from '@heartline/shared';
import { deriveImpact, markdownToText, renderMarkdown } from '@heartline/shared';
import type { Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.ts';
import { openDb } from '../src/db/index.ts';
import { migrate, migrateTo } from '../src/db/migrations.ts';
import { BASE_CONFIG, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const json = async <T>(res: Promise<Response> | Response): Promise<T> => (await res).json() as Promise<T>;

async function setup(config = BASE_CONFIG) {
  h = await harness(config);
  const cookie = await h.login();
  const req = (path: string, method = 'GET', body?: unknown) =>
    h!.request(path.startsWith('/api') ? path : `/api/v1/admin${path}`, { method, cookie, json: body });
  // Both services are up according to their checks.
  const t = Date.now();
  for (const id of ['web', 'api'])
    await h.runtime.engine.record(
      h.runtime.monitors.require(id),
      { status: 'up', latencyMs: 5, message: 'ok' },
      t,
    );
  return { req };
}

describe('impact', () => {
  it('follows the worst affected service', () => {
    expect(deriveImpact([])).toBe('none');
    expect(deriveImpact(['operational'])).toBe('none');
    expect(deriveImpact(['degraded', 'operational'])).toBe('degraded');
    expect(deriveImpact(['degraded', 'partial'])).toBe('partial');
    expect(deriveImpact(['partial', 'down'])).toBe('major');
  });
});

describe('incidents with service statuses', () => {
  it('show the status an open incident gives a service, while uptime stays with the checks', async () => {
    const { req } = await setup();
    const before: ServiceDetail = await json(req('/api/v1/services/api?days=1'));
    const i: Incident = await json(
      req('/incidents', 'POST', {
        title: 'Slow API',
        message: 'Looking into it',
        services: [{ id: 'api', status: 'partial' }],
        notify: false,
      }),
    );
    expect(i).toMatchObject({ impact: 'partial', impactOverride: false });
    expect(i.services).toEqual([{ id: 'api', name: 'API', status: 'partial' }]);
    expect(i.updates[0]?.components).toEqual([
      { id: 'api', name: 'API', oldStatus: null, newStatus: 'partial' },
    ]);

    const o: Overview = await json(req('/api/v1/overview?days=1'));
    const api = o.groups[0]!.services.find((s) => s.id === 'api')!;
    expect(api).toMatchObject({
      status: 'partial',
      checkStatus: 'operational',
      incident: { id: i.id, title: 'Slow API' },
    });
    expect(o.status).toBe('partial');
    expect(o.headline).toBe('Partial outage');
    const during: ServiceDetail = await json(req('/api/v1/services/api?days=1'));
    expect(during.uptime).toBe(before.uptime);

    // Worse, then resolved: the impact keeps its worst, the page shows the check again.
    const worse: Incident = await json(
      req(`/incidents/${i.id}/updates`, 'POST', {
        status: 'identified',
        message: 'Database down',
        services: [{ id: 'api', status: 'down' }],
        notify: false,
      }),
    );
    expect(worse.impact).toBe('major');
    expect(worse.updates[0]?.components).toEqual([
      { id: 'api', name: 'API', oldStatus: 'partial', newStatus: 'down' },
    ]);
    expect(((await json(req('/api/v1/overview?days=1'))) as Overview).headline).toBe('Major outage');
    const done: Incident = await json(
      req(`/incidents/${i.id}/updates`, 'POST', {
        status: 'resolved',
        message: 'Fixed',
        services: [{ id: 'api', status: 'operational' }],
        notify: false,
      }),
    );
    expect(done.impact).toBe('major');
    expect(done.resolvedAt).not.toBeNull();
    const after: Overview = await json(req('/api/v1/overview?days=1'));
    expect(after.status).toBe('operational');
    expect(after.groups[0]!.services.find((s) => s.id === 'api')!.incident).toBeNull();
  });

  it('lets an incident mark a failing service operational, and counts an impact without services', async () => {
    const { req } = await setup();
    // `api` has no automatic incidents, so only the incident below speaks about it.
    const api = h!.runtime.monitors.require('api');
    for (let n = 0; n < 2; n++)
      await h!.runtime.engine.record(api, { status: 'down', latencyMs: null, message: 'no' }, Date.now() + n);
    await req('/incidents', 'POST', {
      title: 'False alarm',
      message: 'Our probe is broken; the API is fine.',
      impact: 'none',
      services: [{ id: 'api', status: 'operational' }],
      notify: false,
    });
    let o: Overview = await json(req('/api/v1/overview?days=1'));
    expect(o.groups[0]!.services.find((s) => s.id === 'api')).toMatchObject({
      status: 'operational',
      checkStatus: 'down',
    });
    expect(o.status).toBe('operational');

    await req('/incidents', 'POST', {
      title: 'Email delays',
      message: 'Slow',
      impact: 'degraded',
      notify: false,
    });
    o = await json(req('/api/v1/overview?days=1'));
    expect(o.status).toBe('degraded');
  });

  it('can set the impact by hand and hand it back to the services', async () => {
    const { req } = await setup();
    const i: Incident = await json(
      req('/incidents', 'POST', {
        title: 'X',
        message: 'm',
        impact: 'major',
        services: ['api'],
        notify: false,
      }),
    );
    // A bare id takes its status from the impact.
    expect(i).toMatchObject({
      impact: 'major',
      impactOverride: true,
      services: [{ id: 'api', status: 'down' }],
    });
    const edited: Incident = await json(
      req(`/incidents/${i.id}`, 'PATCH', { impact: null, services: [{ id: 'api', status: 'degraded' }] }),
    );
    expect(edited).toMatchObject({ impact: 'degraded', impactOverride: false });
  });

  it('backfills incidents and updates at their own time, without notifying', async () => {
    const { req } = await setup();
    const day = 86_400_000;
    const start = Date.now() - 3 * day;
    const i: Incident = await json(
      req('/incidents', 'POST', {
        title: 'Old outage',
        message: 'Down',
        services: [{ id: 'web', status: 'down' }],
        createdAt: new Date(start).toISOString(),
        notify: true,
      }),
    );
    await req(`/incidents/${i.id}/updates`, 'POST', {
      status: 'resolved',
      message: 'Back',
      createdAt: new Date(start + 2 * 3_600_000).toISOString(),
      services: [{ id: 'web', status: 'operational' }],
    });
    // An update written later but dated in between does not reopen it.
    const final: Incident = await json(
      req(`/incidents/${i.id}/updates`, 'POST', {
        status: 'identified',
        message: 'Found the cause',
        createdAt: new Date(start + 3_600_000).toISOString(),
      }),
    );
    expect(final).toMatchObject({ createdAt: start, status: 'resolved', resolvedAt: start + 2 * 3_600_000 });
    expect(final.updates.map((u) => u.status)).toEqual(['resolved', 'identified', 'investigating']);
    expect(final.updates.every((u) => !u.notify)).toBe(true);
    expect(h!.sent).toEqual([]);
    expect(
      (
        await req(`/incidents/${i.id}/updates`, 'POST', {
          status: 'resolved',
          message: 'x',
          createdAt: new Date(start - day).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req('/incidents', 'POST', {
          title: 'F',
          message: 'x',
          createdAt: new Date(Date.now() + day).toISOString(),
        })
      ).status,
    ).toBe(400);
  });

  it('follows an automatic incident between down and degraded', async () => {
    h = await harness();
    const web = h.runtime.monitors.require('web');
    const t = Date.now();
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'no' }, t);
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'no' }, t + 1);
    let open = await h.runtime.incidents.openAutomatic('web');
    expect(open).toMatchObject({ impact: 'major', services: [{ id: 'web', status: 'down' }] });
    await h.runtime.engine.record(web, { status: 'degraded', latencyMs: 900, message: 'slow' }, t + 2);
    open = await h.runtime.incidents.openAutomatic('web');
    expect(open?.services).toEqual([{ id: 'web', name: 'Website', status: 'degraded' }]);
    expect(open?.impact).toBe('major');
  });
});

describe('postmortems', () => {
  it('stay drafts until published', async () => {
    const { req } = await setup();
    const i: Incident = await json(
      req('/incidents', 'POST', { title: 'Outage', message: 'm', notify: false }),
    );
    await req(`/incidents/${i.id}/postmortem`, 'PUT', { body: '## Cause\nA bad deploy.' });
    expect(((await json(req(`/api/v1/incidents/${i.id}`))) as Incident).postmortem).toBeNull();
    expect(((await json(req(`/incidents/${i.id}`))) as Incident).postmortem).toEqual({
      body: '## Cause\nA bad deploy.',
      publishedAt: null,
    });
    const published: Incident = await json(
      req(`/incidents/${i.id}/postmortem`, 'PUT', { body: 'Final', publish: true, notify: true }),
    );
    expect(published.postmortem?.publishedAt).toBeGreaterThan(0);
    expect(((await json(req(`/api/v1/incidents/${i.id}`))) as Incident).postmortem?.body).toBe('Final');
    expect(h!.sent.at(-1)?.url).toContain('teams');
    const removed: Incident = await json(req(`/incidents/${i.id}/postmortem`, 'DELETE'));
    expect(removed.postmortem).toBeNull();
  });
});

describe('markdown', () => {
  it('escapes HTML, drops images and opens links safely', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript');
    expect(renderMarkdown('![x](https://example.com/a.png)')).not.toContain('<img');
    expect(renderMarkdown('see https://example.com')).toContain('rel="noopener noreferrer nofollow"');
    expect(renderMarkdown('line one\nline two')).toContain('<br>');
    expect(markdownToText('**Fixed** in `v2` & <b>done</b>')).toBe('Fixed in v2 & <b>done</b>');
  });
});

describe('templates', () => {
  it('come from status.yaml and the admin API', async () => {
    const { req } = await setup(
      `${BASE_CONFIG}templates:
  - { id: db-failover, kind: incident, name: Database failover, title: Database failover, body: "We are failing over.", impact: major, services: [{ id: api, status: down }] }
  - { kind: maintenance, name: Patch day, title: Monthly patches, duration: 2h, services: [web] }
`,
    );
    let list: TemplateDto[] = await json(req('/templates'));
    expect(list.map((t) => [t.id, t.kind, t.source, t.durationMs])).toEqual([
      ['db-failover', 'incident', 'config', null],
      ['patch-day', 'maintenance', 'config', 7_200_000],
    ]);
    expect(list[0]!.services).toEqual([{ id: 'api', status: 'down' }]);
    expect((await req('/templates/db-failover', 'DELETE')).status).toBe(409);
    const created: TemplateDto = await json(
      req('/templates', 'POST', {
        kind: 'incident',
        name: 'Slow site',
        title: 'The site is slow',
        status: 'investigating',
      }),
    );
    expect(created).toMatchObject({ id: 'slow-site', source: 'db' });
    expect(((await json(req('/templates?kind=maintenance'))) as TemplateDto[]).map((t) => t.id)).toEqual([
      'patch-day',
    ]);
    expect((await req('/templates/slow-site', 'DELETE')).status).toBe(204);

    await h!.runtime.applyConfig(parseConfig(BASE_CONFIG, {}));
    list = await json(req('/templates'));
    expect(list).toEqual([]);
  });
});

describe('incident migration', () => {
  it('gives affected services the status their incident impact stood for', async () => {
    const db = openDb('sqlite::memory:');
    await migrateTo(db.kysely, '0005_groups');
    const k = db.kysely as Kysely<any>;
    const t = 1_700_000_000_000;
    await k
      .insertInto('incidents')
      .values([
        {
          id: 'a',
          title: 'A',
          status: 'resolved',
          impact: 'major',
          automatic: 0,
          created_at: t,
          resolved_at: t + 9,
          created_by: null,
        },
        {
          id: 'b',
          title: 'B',
          status: 'investigating',
          impact: 'partial',
          automatic: 0,
          created_at: t,
          resolved_at: null,
          created_by: null,
        },
        {
          id: 'c',
          title: 'C',
          status: 'investigating',
          impact: 'degraded',
          automatic: 0,
          created_at: t,
          resolved_at: null,
          created_by: null,
        },
      ])
      .execute();
    await k
      .insertInto('incident_services')
      .values([
        { incident_id: 'a', monitor_id: 'web' },
        { incident_id: 'b', monitor_id: 'web' },
        { incident_id: 'c', monitor_id: 'api' },
      ])
      .execute();
    await k
      .insertInto('incident_updates')
      .values({
        id: 'u',
        incident_id: 'a',
        status: 'resolved',
        message: 'm',
        created_at: t + 9,
        author: null,
      })
      .execute();
    await migrate(db.kysely);
    const services = await db.kysely
      .selectFrom('incident_services')
      .select(['incident_id', 'status'])
      .orderBy('incident_id')
      .execute();
    expect(services).toEqual([
      { incident_id: 'a', status: 'down' },
      { incident_id: 'b', status: 'partial' },
      { incident_id: 'c', status: 'degraded' },
    ]);
    const a = await db.kysely
      .selectFrom('incidents')
      .selectAll()
      .where('id', '=', 'a')
      .executeTakeFirstOrThrow();
    expect(a).toMatchObject({ updated_at: t + 9, impact_override: null, postmortem: null });
    await db.close();
  });
});
