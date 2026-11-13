import type { Incident, Overview, ServiceDetail } from '@heartline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, ADMIN, BASE_CONFIG, harness } from './helpers.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const record = (
  id: string,
  status: 'up' | 'degraded' | 'down',
  at = Date.now(),
  latency: number | null = 100,
) =>
  h.runtime.engine.record(
    h.runtime.monitors.require(id),
    { status, latencyMs: latency, message: status === 'up' ? 'ok' : 'HTTP 502' },
    at,
  );

describe('status engine', () => {
  it('builds the overview with day bars and a headline', async () => {
    await record('web', 'up');
    await record('api', 'up');
    let o = (await (await h.request('/api/v1/overview?days=7')).json()) as Overview;
    expect(o.status).toBe('operational');
    expect(o.headline).toBe('All systems operational');
    expect(o.groups[0]?.services[0]?.bars).toHaveLength(7);
    expect(o.groups[0]?.services[0]?.bars.at(-1)).toMatchObject({
      state: 'operational',
      uptime: 100,
      checks: 1,
    });

    await record('web', 'down', Date.now() + 1);
    await record('web', 'down', Date.now() + 2);
    o = (await (await h.request('/api/v1/overview?days=7')).json()) as Overview;
    expect(o.status).toBe('down');
    expect(o.summary).toMatch(/Website is affected/);
    expect(o.groups[0]?.services[0]?.bars.at(-1)?.state).toBe('down');
  });

  it('notifies after the threshold, opens and resolves an automatic incident', async () => {
    const t = Date.now();
    await record('web', 'up', t);
    await record('web', 'down', t + 1);
    expect(h.sent).toHaveLength(0);
    await record('web', 'down', t + 2);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.url).toBe('https://hooks.example/teams');
    expect(JSON.stringify(h.sent[0]?.body)).toContain('Website is down');
    let incidents = (await (await h.request('/api/v1/incidents?active=true')).json()) as Incident[];
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ automatic: true, impact: 'major', status: 'investigating' });

    await record('web', 'up', t + 3);
    expect(JSON.stringify(h.sent[1]?.body)).toContain('Website recovered');
    incidents = (await (await h.request('/api/v1/incidents?active=true')).json()) as Incident[];
    expect(incidents).toHaveLength(0);
  });

  it('suppresses alerts during maintenance and excludes it from uptime', async () => {
    const cookie = await h.login();
    const now = Date.now();
    const res = await h.request('/api/v1/admin/maintenance', {
      method: 'POST',
      cookie,
      json: {
        title: 'Upgrade',
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        services: ['web'],
        notify: false,
      },
    });
    expect(res.status).toBe(201);
    await record('web', 'down', now);
    await record('web', 'down', now + 1);
    expect(h.sent).toHaveLength(0);
    const d = (await (await h.request('/api/v1/services/web?days=1')).json()) as ServiceDetail;
    expect(d.status).toBe('maintenance');
    expect(d.bars.at(-1)?.state).toBe('maintenance');
    expect(d.uptime).toBeNull();
  });

  it('serves fine-grained latency for short ranges and daily points beyond raw retention', async () => {
    const t = Date.now();
    await record('web', 'down', t - 3 * 3_600_000, null);
    await record('web', 'up', t - 3_600_000, 100);
    await record('web', 'up', t - 3_600_000 + 1000, 300);
    await record('web', 'up', t, 50);
    const week = (await (await h.request('/api/v1/services/web?days=7')).json()) as ServiceDetail;
    expect(week.seriesBucketMs).toBe(42 * 60_000);
    expect(week.series.map((p) => p.avgLatencyMs)).toEqual([null, 200, 50]);
    expect(week.series.map((p) => p.state)).toEqual(['down', 'operational', 'operational']);
    expect(week.series[0]).toMatchObject({ checks: 1, down: 1 });
    expect(week.series[1]?.highLatencyMs).toBe(300);
    const quarter = (await (await h.request('/api/v1/services/web?days=90')).json()) as ServiceDetail;
    expect(quarter.seriesBucketMs).toBe(86_400_000);
    expect(quarter.series).toHaveLength(90);
  });

  it('exports a CSV report', async () => {
    await record('web', 'up');
    const res = await h.request('/api/v1/services/web/report.csv?days=2');
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toMatch(/^service,day,state,uptime_percent/);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/^web,\d{4}-\d{2}-\d{2},operational,100,1,1,0,0,0,100,/);
  });
});

describe('auth and permissions', () => {
  it('protects admin routes and accepts the seeded admin', async () => {
    expect((await h.request('/api/v1/admin/monitors')).status).toBe(401);
    const cookie = await h.login();
    const me = await (await h.request('/api/v1/me', { cookie })).json();
    expect(me).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect((await h.request('/api/v1/admin/monitors', { cookie })).status).toBe(200);
  });

  it('rejects wrong passwords and self-signup', async () => {
    await expect(h.login(ADMIN.email, 'wrong-password-123')).rejects.toThrow(/401/);
    const res = await h.request('/api/auth/sign-up/email', {
      method: 'POST',
      json: { email: 'x@y.z', password: 'long-enough-password', name: 'x' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('enforces API token scopes', async () => {
    const cookie = await h.login();
    const read = await (
      await h.request('/api/v1/admin/tokens', {
        method: 'POST',
        cookie,
        json: { name: 'r', scopes: ['read'] },
      })
    ).json();
    const write = await (
      await h.request('/api/v1/admin/tokens', {
        method: 'POST',
        cookie,
        json: { name: 'w', scopes: ['write'] },
      })
    ).json();
    expect(read.token).toMatch(/^hl_/);
    const incident = { title: 'Slow', message: 'Investigating', services: ['web'] };
    expect(
      (await h.request('/api/v1/admin/incidents', { method: 'POST', token: read.token, json: incident }))
        .status,
    ).toBe(403);
    expect(
      (await h.request('/api/v1/admin/incidents', { method: 'POST', token: write.token, json: incident }))
        .status,
    ).toBe(201);
    expect((await h.request('/api/v1/admin/users', { token: write.token })).status).toBe(403);
    expect(
      (
        await h.request('/api/v1/admin/tokens', {
          method: 'POST',
          token: write.token,
          json: { name: 'x', scopes: ['read'] },
        })
      ).status,
    ).toBe(403);
    expect((await h.request('/api/v1/admin/monitors', { token: 'hl_invalid' })).status).toBe(401);

    expect((await h.request(`/api/v1/admin/tokens/${read.id}`, { method: 'DELETE', cookie })).status).toBe(
      204,
    );
    expect((await h.request('/api/v1/admin/monitors', { token: read.token })).status).toBe(401);
  });

  it('caps what a viewer can do and grant', async () => {
    const cookie = await h.login();
    const created = await h.request('/api/v1/admin/users', {
      method: 'POST',
      cookie,
      json: { email: 'viewer@test.local', name: 'Viewer', password: 'viewer-password-123', role: 'viewer' },
    });
    expect(created.status).toBe(201);
    const viewer = await h.login('viewer@test.local', 'viewer-password-123');
    expect(
      (
        await h.request('/api/v1/admin/tokens', {
          method: 'POST',
          cookie: viewer,
          json: { name: 'x', scopes: ['write'] },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.request('/api/v1/admin/incidents', {
          method: 'POST',
          cookie: viewer,
          json: { title: 't', message: 'm' },
        })
      ).status,
    ).toBe(403);
    expect((await h.request('/api/v1/admin/monitors', { cookie: viewer })).status).toBe(200);
  });

  it('prevents admins from demoting themselves', async () => {
    const cookie = await h.login();
    const me = await (await h.request('/api/v1/me', { cookie })).json();
    const res = await h.request(`/api/v1/admin/users/${me.id}`, {
      method: 'PATCH',
      cookie,
      json: { role: 'viewer' },
    });
    expect(res.status).toBe(400);
  });
});

describe('monitors via API', () => {
  it('creates, edits, pauses and deletes UI monitors but not config ones', async () => {
    const cookie = await h.login();
    const spec = { id: 'dns', name: 'DNS', type: 'dns', host: 'example.com' };
    expect(
      (await h.request('/api/v1/admin/monitors', { method: 'POST', cookie, json: { group: 'Infra', spec } }))
        .status,
    ).toBe(201);
    expect(
      (await h.request('/api/v1/admin/monitors', { method: 'POST', cookie, json: { group: 'Infra', spec } }))
        .status,
    ).toBe(409);
    const edited = await h.request('/api/v1/admin/monitors/dns', {
      method: 'PUT',
      cookie,
      json: { group: 'Infra', spec: { ...spec, name: 'Resolver' } },
    });
    expect((await edited.json()).name).toBe('Resolver');
    expect(
      (
        await h.request('/api/v1/admin/monitors/web', {
          method: 'PUT',
          cookie,
          json: { group: 'Web', spec: { id: 'web', name: 'x', type: 'icmp', host: 'h' } },
        })
      ).status,
    ).toBe(409);
    expect((await h.request('/api/v1/admin/monitors/web', { method: 'DELETE', cookie })).status).toBe(409);
    const paused = await (
      await h.request('/api/v1/admin/monitors/dns/pause', { method: 'POST', cookie, json: { paused: true } })
    ).json();
    expect(paused).toMatchObject({ paused: true, status: 'paused' });
    const o = (await (await h.request('/api/v1/overview')).json()) as Overview;
    expect(o.groups.map((g) => g.name)).toEqual(['Web', 'Infra']);
    expect((await h.request('/api/v1/admin/monitors/dns', { method: 'DELETE', cookie })).status).toBe(204);
  });

  it('validates plugin monitors against the manifest', async () => {
    const cookie = await h.login();
    const res = await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: { group: 'X', spec: { id: 'p', name: 'P', type: 'plugin', plugin: 'echo-json', args: {} } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing required arg/);
    const test = await (
      await h.request('/api/v1/admin/plugins/test', {
        method: 'POST',
        cookie,
        json: { plugin: 'echo-json', args: { status: 'up' } },
      })
    ).json();
    expect(test).toMatchObject({ status: 'up', latencyMs: 42 });
  });

  it('reconciles config changes without touching UI monitors', async () => {
    const cookie = await h.login();
    await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: { group: 'Infra', spec: { id: 'ui', name: 'UI', type: 'icmp', host: 'h' } },
    });
    const { parseConfig } = await import('../src/config/load.ts');
    await h.runtime.applyConfig(parseConfig(BASE_CONFIG.replace(/      - \{ id: api.*\n/, ''), {}));
    expect(
      h.runtime.monitors
        .list()
        .map((m) => m.id)
        .toSorted(),
    ).toEqual(['ui', 'web']);
  });
});

describe('incidents via API', () => {
  it('posts updates, resolves and notifies', async () => {
    const cookie = await h.login();
    const created = (await (
      await h.request('/api/v1/admin/incidents', {
        method: 'POST',
        cookie,
        json: { title: 'Slow sync', message: 'Looking into it', services: ['web'], impact: 'degraded' },
      })
    ).json()) as Incident;
    expect(h.sent).toHaveLength(1);
    const updated = (await (
      await h.request(`/api/v1/admin/incidents/${created.id}/updates`, {
        method: 'POST',
        cookie,
        json: { status: 'resolved', message: 'Fixed', notify: false },
      })
    ).json()) as Incident;
    expect(updated.status).toBe('resolved');
    expect(updated.resolvedAt).not.toBeNull();
    expect(updated.updates.map((u) => u.status)).toEqual(['resolved', 'investigating']);
    expect(updated.updates[0]?.author).toBe('Admin');
    expect(h.sent).toHaveLength(1);
    const rss = await (await h.request('/api/v1/incidents.rss')).text();
    expect(rss).toContain('<title>Slow sync (resolved)</title>');
  });
});

describe('private status page', () => {
  it('requires sign-in for public routes but keeps bootstrap routes open', async () => {
    await h.close();
    h = await harness(
      BASE_CONFIG.replace(
        'site: { title: Test status, timezone: UTC }',
        'site: { title: Test status, timezone: UTC, public: false }',
      ),
    );
    expect((await h.request('/api/v1/overview')).status).toBe(401);
    expect((await h.request('/api/v1/site')).status).toBe(200);
    const cookie = await h.login();
    expect((await h.request('/api/v1/overview', { cookie })).status).toBe(200);
  });
});
