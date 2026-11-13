import { afterEach, describe, expect, it } from 'vitest';
import { evaluateStatuspage } from '../src/checks/provider.ts';
import { pageStatus } from '../src/statuspage/map.ts';
import { ADMIN, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const yaml = (site = '') => `
site: { title: Acme status, timezone: Europe/Berlin ${site} }
groups:
  - name: Core
    description: The core
    monitors:
      - { id: web, name: Website, type: tcp, host: 127.0.0.1, port: 1, description: Our homepage }
      - { id: api, name: API, type: tcp, host: 127.0.0.1, port: 1 }
      - { id: fresh, name: Not checked yet, type: tcp, host: 127.0.0.1, port: 1 }
  - name: Third-party
    monitors:
      - { id: gh, name: GitHub, type: provider, provider: github }
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

async function setup(site = '') {
  h = await harness(yaml(site));
  const t = Date.now();
  await h.runtime.engine.record(
    h.runtime.monitors.require('web'),
    { status: 'up', latencyMs: 5, message: 'ok' },
    t,
  );
  await h.runtime.engine.record(
    h.runtime.monitors.require('api'),
    { status: 'up', latencyMs: 5, message: 'ok' },
    t,
  );
  return { cookie: await h.login() };
}

const get = async (path: string) => (await h!.request(`/api/v2/${path}`)).json();

describe('Statuspage-compatible API', () => {
  it('describes the page and its components in Statuspage shapes', async () => {
    await setup();
    const s = await get('summary.json');
    expect(s.page).toMatchObject({
      name: 'Acme status',
      url: 'http://localhost:3999',
      time_zone: 'Europe/Berlin',
    });
    expect(s.page.id).toMatch(/^[0-9a-f]{12}$/);
    expect(s.status).toEqual({ indicator: 'none', description: 'All Systems Operational' });
    // Own services only; a service without a result yet is left out, third-party ones too.
    expect(s.components.map((c: { id: string }) => c.id)).toEqual(['group.core', 'web', 'api']);
    expect(s.components[0]).toMatchObject({
      group: true,
      group_id: null,
      components: ['web', 'api'],
      description: 'The core',
    });
    expect(s.components[1]).toMatchObject({
      name: 'Website',
      status: 'operational',
      group_id: 'group.core',
      position: 1,
      description: 'Our homepage',
      showcase: true,
      page_id: s.page.id,
    });
    expect(Object.keys(await get('status.json'))).toEqual(['page', 'status']);
    expect((await get('components.json')).components).toHaveLength(3);
    expect((await h!.request('/api/v2/summary.json')).headers.get('cache-control')).toBe(
      'public, max-age=30',
    );
  });

  it('maps incidents, their updates and maintenance', async () => {
    const { cookie } = await setup();
    const req = (path: string, json: unknown) =>
      h!.request(`/api/v1/admin/${path}`, { method: 'POST', cookie, json });
    const i = await (
      await req('incidents', {
        title: 'API errors',
        message: 'Looking',
        services: [{ id: 'api', status: 'partial' }],
        notify: false,
      })
    ).json();
    await req(`incidents/${i.id}/updates`, {
      status: 'monitoring',
      message: 'Fix deployed',
      services: [{ id: 'api', status: 'degraded' }],
      notify: false,
    });
    const now = Date.now();
    await req('maintenance', {
      title: 'Upgrade',
      description: 'New **DB**',
      startsAt: new Date(now + 3_600_000).toISOString(),
      endsAt: new Date(now + 7_200_000).toISOString(),
      services: ['web'],
      notify: false,
    });
    await req('maintenance', {
      title: 'Running',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 600_000).toISOString(),
      services: ['api'],
      notify: false,
    });

    const s = await get('summary.json');
    // The incident keeps the worst impact it reached (partial), so the page stays at "major".
    expect(s.status).toEqual({ indicator: 'major', description: 'Partial System Outage' });
    expect(s.incidents).toHaveLength(1);
    const inc = s.incidents[0];
    expect(inc).toMatchObject({
      name: 'API errors',
      status: 'monitoring',
      impact: 'major',
      shortlink: `http://localhost:3999/incidents/${i.id}`,
    });
    expect(inc.monitoring_at).not.toBeNull();
    expect(inc.incident_updates[0]).toMatchObject({
      status: 'monitoring',
      body: 'Fix deployed',
      deliver_notifications: false,
      affected_components: [
        { code: 'api', name: 'API', old_status: 'partial_outage', new_status: 'degraded_performance' },
      ],
    });
    expect(inc.components).toMatchObject([{ id: 'api', status: 'degraded_performance' }]);
    expect(
      s.scheduled_maintenances.map((m: { name: string; status: string }) => [m.name, m.status]).toSorted(),
    ).toEqual([
      ['Running', 'in_progress'],
      ['Upgrade', 'scheduled'],
    ]);
    const upgrade = s.scheduled_maintenances.find((m: { name: string }) => m.name === 'Upgrade');
    expect(upgrade).toMatchObject({ impact: 'maintenance', components: [{ id: 'web' }] });
    expect(upgrade.scheduled_for).toBe(new Date(Date.parse(upgrade.scheduled_for)).toISOString());
    expect(upgrade.incident_updates.at(-1).body).toBe('New **DB**');
    expect(
      (await get('scheduled-maintenances/active.json')).scheduled_maintenances.map(
        (m: { name: string }) => m.name,
      ),
    ).toEqual(['Running']);
    expect(
      (await get('scheduled-maintenances/upcoming.json')).scheduled_maintenances.map(
        (m: { name: string }) => m.name,
      ),
    ).toEqual(['Upgrade']);
    expect((await get('incidents/unresolved.json')).incidents).toHaveLength(1);
    // The open incident's status wins over the maintenance window running on the same service.
    expect((await get('components.json')).components.find((c: { id: string }) => c.id === 'api').status).toBe(
      'degraded_performance',
    );
  });

  it('can be read by a Statuspage client, such as heartline itself', async () => {
    const { cookie } = await setup();
    await h!.request('/api/v1/admin/incidents', {
      method: 'POST',
      cookie,
      json: { title: 'Down', message: 'x', services: [{ id: 'web', status: 'down' }], notify: false },
    });
    const findings = evaluateStatuspage(await get('summary.json'), ['Website']);
    expect(findings.map((f) => f.level)).toContain('down');
  });

  it('words the overall status like Statuspage', () => {
    expect(pageStatus({ status: 'down', headline: 'Major outage' })).toEqual({
      indicator: 'critical',
      description: 'Major System Outage',
    });
    expect(pageStatus({ status: 'down', headline: 'Partial outage' })).toEqual({
      indicator: 'major',
      description: 'Partial System Outage',
    });
    expect(pageStatus({ status: 'maintenance', headline: '' }).indicator).toBe('maintenance');
  });

  it('needs sign-in on a private site', async () => {
    const { cookie } = await setup(', public: false');
    expect((await h!.request('/api/v2/summary.json')).status).toBe(401);
    const res = await h!.request('/api/v2/summary.json', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=30');
  });
});
