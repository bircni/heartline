import type { Incident, Maintenance, Overview, ServiceDetail } from '@heartline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, harness } from './helpers.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

describe('OpenAPI', () => {
  it('describes every /api/v1 route the server registers', async () => {
    const res = await h.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe('3.1.0');
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)),
    );
    const registered = h.app.routes
      .filter((r) => r.path.startsWith('/api/v1/') && r.method !== 'ALL' && !r.path.endsWith('/*'))
      .map(
        (r) =>
          `${r.method} ${r.path.replace(/:([a-z]+)\{[^}]*\}/g, '{$1}.svg').replace(/:([a-z]+)/g, '{$1}')}`,
      );
    expect(registered.length).toBeGreaterThan(30);
    const missing = [...new Set(registered)].filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
    const docs = await h.request('/api/docs');
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain('/api/v1/software');
  });

  it('reports its own version', async () => {
    const v = (await (await h.request('/api/v1/version')).json()) as { name: string; version: string };
    expect(v.name).toBe('heartline');
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('incident and maintenance editing', () => {
  it('edits incident fields without posting an update', async () => {
    const cookie = await h.login();
    const created = (await (
      await h.request('/api/v1/admin/incidents', {
        method: 'POST',
        cookie,
        json: { title: 'Slow', message: 'Looking', services: ['web'], notify: false },
      })
    ).json()) as Incident;
    const res = await h.request(`/api/v1/admin/incidents/${created.id}`, {
      method: 'PATCH',
      cookie,
      json: { title: 'Slow API', impact: 'major', services: ['api'] },
    });
    expect(res.status).toBe(200);
    const edited = (await res.json()) as Incident;
    expect(edited).toMatchObject({ title: 'Slow API', impact: 'major' });
    expect(edited.services.map((s) => s.id)).toEqual(['api']);
    expect(edited.updates).toHaveLength(1);
    expect(
      (await h.request(`/api/v1/admin/incidents/${created.id}`, { method: 'PATCH', cookie, json: {} }))
        .status,
    ).toBe(400);
    expect(
      (
        await h.request(`/api/v1/admin/incidents/${created.id}`, {
          method: 'PATCH',
          cookie,
          json: { services: ['nope'] },
        })
      ).status,
    ).toBe(404);
  });

  it('edits and fetches maintenance windows', async () => {
    const cookie = await h.login();
    const now = Date.now();
    const created = (await (
      await h.request('/api/v1/admin/maintenance', {
        method: 'POST',
        cookie,
        json: {
          title: 'Patch night',
          startsAt: new Date(now + 3_600_000).toISOString(),
          endsAt: new Date(now + 7_200_000).toISOString(),
          services: ['web'],
        },
      })
    ).json()) as Maintenance;
    const one = await h.request(`/api/v1/maintenance/${created.id}`);
    expect(one.status).toBe(200);
    expect(((await one.json()) as Maintenance).title).toBe('Patch night');
    expect((await h.request('/api/v1/maintenance/nope')).status).toBe(404);

    const res = await h.request(`/api/v1/admin/maintenance/${created.id}`, {
      method: 'PUT',
      cookie,
      json: {
        title: 'Patch night (moved)',
        endsAt: new Date(now + 10_800_000).toISOString(),
        recurrence: 'FREQ=WEEKLY',
        services: [],
      },
    });
    expect(res.status).toBe(200);
    const edited = (await res.json()) as Maintenance;
    expect(edited).toMatchObject({
      title: 'Patch night (moved)',
      endsAt: now + 10_800_000,
      recurrence: 'FREQ=WEEKLY',
      services: [],
    });
    expect(
      (
        await h.request(`/api/v1/admin/maintenance/${created.id}`, {
          method: 'PUT',
          cookie,
          json: { endsAt: new Date(now).toISOString() },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.request(`/api/v1/admin/maintenance/${created.id}`, {
          method: 'PUT',
          cookie,
          json: { recurrence: 'FREQ=NEVER' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('admin hardening', () => {
  it('refuses all=true for non-admin token holders instead of narrowing silently', async () => {
    const cookie = await h.login();
    const { token } = (await (
      await h.request('/api/v1/admin/tokens', {
        method: 'POST',
        cookie,
        json: { name: 'r', scopes: ['read'] },
      })
    ).json()) as { token: string };
    expect((await h.request('/api/v1/admin/tokens?all=true', { token })).status).toBe(403);
    expect((await h.request('/api/v1/admin/tokens?all=true', { cookie })).status).toBe(200);
  });

  it('rejects unknown notifiers and purges references when a monitor is deleted', async () => {
    const cookie = await h.login();
    const bad = await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: { group: 'X', spec: { id: 'x', name: 'X', type: 'tcp', host: 'h', port: 1, notify: ['nope'] } },
    });
    expect(bad.status).toBe(400);
    const invalid = await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: { group: 'X', spec: { id: 'x', name: 'X', type: 'tcp', host: 'h', port: 'nope' } },
    });
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as { error: string; issues: { path: string; message: string }[] };
    expect(body.error).toBeTruthy();
    expect(body.issues.map((i) => i.path)).toContain('spec.port');
    expect(
      (
        await h.request('/api/v1/admin/monitors', {
          method: 'POST',
          cookie,
          json: { group: 'X', spec: { id: 'x', name: 'X', type: 'tcp', host: 'h', port: 1 } },
        })
      ).status,
    ).toBe(201);
    await h.request('/api/v1/admin/incidents', {
      method: 'POST',
      cookie,
      json: { title: 'X down', message: 'm', services: ['x'], notify: false },
    });
    expect((await h.request('/api/v1/admin/monitors/x', { cookie })).status).toBe(200);
    expect((await h.request('/api/v1/admin/monitors/x', { method: 'DELETE', cookie })).status).toBe(204);
    const links = await h.runtime.db.kysely
      .selectFrom('incident_services')
      .selectAll()
      .where('monitor_id', '=', 'x')
      .execute();
    expect(links).toEqual([]);
    expect((await h.request('/api/v1/admin/monitors/x', { cookie })).status).toBe(404);
  });
});

describe('history ranges', () => {
  it('ends the overview and service history on the requested day', async () => {
    const overview = (await (await h.request('/api/v1/overview?days=7&to=2026-01-31')).json()) as Overview;
    const bars = overview.groups.flatMap((g) => g.services)[0]?.bars ?? [];
    expect(bars.map((b) => b.day)).toEqual([
      '2026-01-25',
      '2026-01-26',
      '2026-01-27',
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
    ]);
    expect(overview.site.theme).toBe('green');

    const detail = (await (
      await h.request('/api/v1/services/web?days=3&to=2026-01-31')
    ).json()) as ServiceDetail;
    expect(detail.bars.map((b) => b.day)).toEqual(['2026-01-29', '2026-01-30', '2026-01-31']);
    expect(detail.rangeStart).toBe(Date.parse('2026-01-29T00:00:00Z'));
    expect(detail.rangeEnd).toBe(Date.parse('2026-02-01T00:00:00Z') - 1);

    const csv = await (await h.request('/api/v1/report.csv?days=2&to=2026-01-31')).text();
    const webDays = csv
      .split('\n')
      .filter((l) => l.startsWith('web,'))
      .map((l) => l.split(',')[1]);
    expect(webDays).toEqual(['2026-01-30', '2026-01-31']);
  });

  it('treats a day in the future as today and rejects anything that is not a date', async () => {
    const future = (await (
      await h.request('/api/v1/services/web?days=1&to=2999-01-01')
    ).json()) as ServiceDetail;
    expect(future.rangeEnd).toBeLessThanOrEqual(Date.now());
    expect((await h.request('/api/v1/overview?to=yesterday')).status).toBe(400);
    expect((await h.request('/api/v1/overview?to=2026-02-31')).status).toBe(400);
  });
});

describe('incident history paging', () => {
  it('pages with a cursor and filters by text, impact, service and state', async () => {
    const cookie = await h.login();
    const make = (title: string, impact: string, services: string[]) =>
      h.request('/api/v1/admin/incidents', {
        method: 'POST',
        cookie,
        json: { title, message: 'm', impact, services, notify: false },
      });
    for (let i = 0; i < 5; i++)
      await make(`Outage ${i}`, i % 2 ? 'major' : 'degraded', i < 2 ? ['api'] : ['web']);
    await make('Slow_search 100%', 'partial', []);
    // Resolve all but the last one.
    const all: Incident[] = await (await h.request('/api/v1/incidents?limit=50')).json();
    for (const i of all.slice(1))
      await h.request(`/api/v1/admin/incidents/${i.id}/updates`, {
        method: 'POST',
        cookie,
        json: { status: 'resolved', message: 'ok', notify: false },
      });

    const first = await h.request('/api/v1/incidents?state=resolved&limit=2');
    const page1: Incident[] = await first.json();
    const cursor = first.headers.get('x-next-cursor');
    expect(page1).toHaveLength(2);
    expect(cursor).toBe(`${page1[1]!.createdAt}:${page1[1]!.id}`);
    const page2: Incident[] = await (
      await h.request(`/api/v1/incidents?state=resolved&limit=2&before=${encodeURIComponent(cursor!)}`)
    ).json();
    const page3res = await h.request(
      `/api/v1/incidents?state=resolved&limit=2&before=${encodeURIComponent(`${page2[1]!.createdAt}:${page2[1]!.id}`)}`,
    );
    const page3: Incident[] = await page3res.json();
    expect(page3res.headers.get('x-next-cursor')).toBeNull();
    const ids = [...page1, ...page2, ...page3].map((i) => i.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(all.slice(1).map((i) => i.id));

    const titles = async (q: string) =>
      ((await (await h.request(`/api/v1/incidents?${q}`)).json()) as Incident[]).map((i) => i.title);
    expect(await titles('q=outage%203')).toEqual(['Outage 3']);
    // LIKE wildcards in the search are literal.
    expect(await titles('q=_search%20100%25')).toEqual(['Slow_search 100%']);
    expect(await titles('q=%25')).toEqual(['Slow_search 100%']);
    expect(await titles('impact=major')).toEqual(['Outage 3', 'Outage 1']);
    expect(await titles('service=api')).toEqual(['Outage 1', 'Outage 0']);
    expect(await titles('state=open')).toEqual(['Slow_search 100%']);
  });
});
