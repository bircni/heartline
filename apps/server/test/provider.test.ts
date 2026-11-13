import { once } from 'node:events';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AdminMonitor, Overview, ServiceDetail } from '@heartline/shared';
import { monitorSpecSchema } from '@heartline/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/checks/index.ts';
import { PluginRegistry } from '../src/checks/plugins.ts';
import { evaluateFeed, m365Endpoints } from '../src/checks/provider.ts';
import { SECRET_MASK } from '../src/services/monitors.ts';
import { nextState } from '../src/status/engine.ts';
import { ADMIN, type Harness, harness } from './helpers.ts';

const plugins = new PluginRegistry(fileURLToPath(new URL('./fixtures/plugins', import.meta.url)));

const component = (id: string, name: string, status = 'operational', extra: object = {}) => ({
  id,
  name,
  status,
  group: false,
  group_id: null,
  ...extra,
});

const statuspage = (components: object[], incidents: object[] = [], maintenances: object[] = []) => ({
  page: { id: 'p', name: 'Example', url: 'https://status.example.com' },
  status: { indicator: 'none', description: 'All Systems Operational' },
  components,
  incidents,
  scheduled_maintenances: maintenances,
});

/** Path → [status, body]; bodies are JSON unless they are strings. */
let routes: Record<string, [number, unknown]> = {};
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = routes[req.url ?? ''];
    if (!route) {
      res.statusCode = 404;
      return res.end();
    }
    res.statusCode = route[0];
    res.end(typeof route[1] === 'string' ? route[1] : JSON.stringify(route[1]));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  m365Endpoints.login = base;
  m365Endpoints.graph = base;
});
afterAll(() => server.close());

const check = (input: Record<string, unknown>) =>
  runCheck(monitorSpecSchema.parse({ id: 'p', name: 'P', type: 'provider', ...input }), plugins);

describe('provider spec', () => {
  it('applies provider defaults and validates presets', () => {
    const spec = monitorSpecSchema.parse({ id: 'gh', name: 'GitHub', type: 'provider', provider: 'github' });
    expect(spec).toMatchObject({ interval: 300_000, failureThreshold: 1, components: [], dependsOn: [] });
    expect(() => monitorSpecSchema.parse({ id: 'x', name: 'X', type: 'provider', provider: 'nope' })).toThrow(
      /unknown provider/,
    );
    expect(() =>
      monitorSpecSchema.parse({ id: 'x', name: 'X', type: 'provider', provider: 'statuspage' }),
    ).toThrow(/needs a url/);
    expect(() => monitorSpecSchema.parse({ id: 'x', name: 'X', type: 'provider', provider: 'm365' })).toThrow(
      /tenantId/,
    );
    expect(() =>
      monitorSpecSchema.parse({ id: 'x', name: 'X', type: 'tcp', host: 'h', port: 1, dependsOn: ['x'] }),
    ).toThrow(/depend on itself/);
  });
});

describe('Atlassian Statuspage', () => {
  it('maps component states and lists incidents', async () => {
    routes = {
      '/ok/api/v2/summary.json': [200, statuspage([component('a', 'API'), component('b', 'Search')])],
      '/bad/api/v2/summary.json': [
        200,
        statuspage(
          [component('a', 'API', 'major_outage'), component('b', 'Search', 'partial_outage')],
          [
            {
              name: 'API errors',
              status: 'investigating',
              impact: 'major',
              shortlink: 'https://stspg.io/x',
              components: [{ id: 'a' }],
            },
          ],
        ),
      ],
    };
    expect(await check({ provider: 'statuspage', url: `${base}/ok` })).toEqual({
      status: 'up',
      latencyMs: null,
      message: null,
    });
    const bad = await check({ provider: 'statuspage', url: `${base}/bad/` });
    expect(bad.status).toBe('down');
    expect(bad.message).toBe('API (major outage), Search (partial outage) – API errors https://stspg.io/x');
    // Only the selected component counts, and only incidents touching it.
    const search = await check({ provider: 'statuspage', url: `${base}/bad`, components: ['search'] });
    expect(search).toMatchObject({ status: 'degraded', message: 'Search (partial outage)' });
  });

  it('selects component groups, reports maintenance and unknown names', async () => {
    routes = {
      '/g/api/v2/summary.json': [
        200,
        statuspage(
          [
            component('g', 'Jira', 'under_maintenance', { group: true }),
            component('j1', 'Jira Search', 'under_maintenance', { group_id: 'g' }),
            component('c1', 'Confluence', 'operational'),
          ],
          [],
          [{ name: 'Database upgrade', status: 'in_progress', components: [{ id: 'j1' }] }],
        ),
      ],
    };
    const jira = await check({ provider: 'statuspage', url: `${base}/g`, components: ['Jira'] });
    expect(jira.status).toBe('maintenance');
    expect(jira.message).toContain('Maintenance: Database upgrade');
    expect(
      (await check({ provider: 'statuspage', url: `${base}/g`, components: ['Confluence'] })).status,
    ).toBe('up');
    expect(await check({ provider: 'statuspage', url: `${base}/g`, components: ['Bamboo'] })).toMatchObject({
      status: 'unknown',
      message: 'status unavailable: no component named Bamboo',
    });
  });

  it('reports an unreachable or broken status page as unknown, not down', async () => {
    routes = { '/err/api/v2/summary.json': [503, 'oops'], '/html/api/v2/summary.json': [200, '<html>'] };
    expect(await check({ provider: 'statuspage', url: `${base}/err` })).toMatchObject({
      status: 'unknown',
      message: 'status unavailable: status source answered HTTP 503',
    });
    expect((await check({ provider: 'statuspage', url: `${base}/html` })).message).toContain(
      'did not return JSON',
    );
    expect((await check({ provider: 'statuspage', url: 'http://127.0.0.1:1' })).status).toBe('unknown');
  });
});

describe('Google, Slack and feeds', () => {
  it('reads open Google incidents per product', async () => {
    routes = {
      '/google': [
        200,
        [
          {
            begin: '2026-11-13T06:00:00+00:00',
            end: null,
            external_desc: 'Gmail delivery delays\nmore text',
            status_impact: 'SERVICE_DISRUPTION',
            severity: 'medium',
            affected_products: [{ title: 'Gmail', id: '1' }],
            uri: 'incidents/abc',
          },
          {
            begin: '2026-11-01T06:00:00+00:00',
            end: '2026-11-01T08:00:00+00:00',
            external_desc: 'old outage',
            status_impact: 'SERVICE_OUTAGE',
            affected_products: [{ title: 'Google Drive', id: '2' }],
          },
        ],
      ],
    };
    const gmail = await check({ provider: 'google-workspace', url: `${base}/google`, components: ['Gmail'] });
    expect(gmail.status).toBe('degraded');
    expect(gmail.message).toBe(
      'Gmail – Gmail delivery delays https://www.google.com/appsstatus/dashboard/incidents/abc',
    );
    const drive = await check({
      provider: 'google-workspace',
      url: `${base}/google`,
      components: ['Google Drive'],
    });
    expect(drive).toMatchObject({ status: 'up', message: null });
  });

  it('reads Slack incidents by type', async () => {
    routes = {
      '/slack': [
        200,
        {
          status: 'broken',
          active_incidents: [
            {
              title: 'Messages fail to send',
              type: 'outage',
              status: 'active',
              services: ['Messaging'],
              url: 'https://slack-status.com/1',
            },
            { title: 'Huddles slow', type: 'incident', status: 'active', services: ['Huddles'] },
          ],
        },
      ],
    };
    expect((await check({ provider: 'slack', url: `${base}/slack` })).status).toBe('down');
    expect(await check({ provider: 'slack', url: `${base}/slack`, components: ['huddles'] })).toMatchObject({
      status: 'degraded',
      message: 'Huddles – Huddles slow',
    });
  });

  it('treats open feed entries as issues', async () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    const rss = `<?xml version="1.0"?><rss><channel><title>Azure</title>
      <item><title><![CDATA[Virtual Machines - West Europe - Mitigation in progress]]></title>
        <link>https://azure.status.microsoft/x</link><pubDate>Wed, 13 Nov 2026 11:00:00 GMT</pubDate></item>
      <item><title>Storage &amp; Networking - resolved</title><pubDate>Wed, 13 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Old event</title><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(evaluateFeed(rss, [], null, now)).toEqual([
      {
        level: 'degraded',
        note: 'Virtual Machines - West Europe - Mitigation in progress https://azure.status.microsoft/x',
      },
      { level: 'degraded', note: 'Old event' },
    ]);
    // A window keeps only recent entries; components filter on the title.
    expect(evaluateFeed(rss, [], 6 * 3_600_000, now)).toHaveLength(1);
    expect(evaluateFeed(rss, ['west europe'], null, now)).toHaveLength(1);
    expect(evaluateFeed(rss, ['east us'], null, now)).toHaveLength(0);
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Login issues</title>
      <link href="https://status.example.com/i/1"/><updated>2026-11-13T11:30:00Z</updated></entry></feed>`;
    expect(evaluateFeed(atom, [], 3_600_000, now)).toEqual([
      { level: 'degraded', note: 'Login issues https://status.example.com/i/1' },
    ]);
    routes = { '/feed': [200, atom.replace('2026-11-13T11:30:00Z', '2020-01-01T00:00:00Z')] };
    // The entry is older than the 6h default window.
    expect(await check({ provider: 'feed', url: `${base}/feed` })).toMatchObject({ status: 'up' });
  });
});

describe('Microsoft 365', () => {
  const m365 = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret' };
  it('signs in with client credentials and maps service health', async () => {
    routes = {
      '/tenant/oauth2/v2.0/token': [200, { access_token: 't0k', expires_in: 3600 }],
      '/v1.0/admin/serviceAnnouncement/healthOverviews': [
        200,
        {
          value: [
            { id: 'Exchange', service: 'Exchange Online', status: 'serviceDegradation' },
            { id: 'microsoftteams', service: 'Microsoft Teams', status: 'serviceOperational' },
            { id: 'SharePoint', service: 'SharePoint Online', status: 'serviceInterruption' },
          ],
        },
      ],
      [`/v1.0/admin/serviceAnnouncement/issues?$filter=${encodeURIComponent('isResolved eq false')}`]: [
        200,
        { value: [{ id: 'EX123', title: 'Mail delays', service: 'Exchange Online', isResolved: false }] },
      ],
    };
    expect((await check({ provider: 'm365', m365 })).status).toBe('down');
    expect(await check({ provider: 'm365', m365, components: ['Exchange Online'] })).toMatchObject({
      status: 'degraded',
      message: 'Exchange Online (service degradation) – EX123: Mail delays',
    });
    expect((await check({ provider: 'm365', m365, components: ['microsoftteams'] })).status).toBe('up');
  });
  it('reports a failed sign-in as unknown', async () => {
    routes = {
      '/other/oauth2/v2.0/token': [
        401,
        { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret.\nTrace' },
      ],
    };
    expect(await check({ provider: 'm365', m365: { ...m365, tenantId: 'other' } })).toMatchObject({
      status: 'unknown',
      message: 'status unavailable: Microsoft sign-in failed: AADSTS7000215: Invalid client secret.',
    });
  });
});

describe('engine with provider results', () => {
  it('keeps failures on unknown results and treats provider maintenance as maintenance', () => {
    expect(nextState({ status: 'down', failures: 3 }, 'unknown', 1, false)).toEqual({
      status: 'unknown',
      failures: 3,
    });
    expect(nextState({ status: 'operational', failures: 0 }, 'maintenance', 1, false)).toEqual({
      status: 'maintenance',
      failures: 0,
    });
  });
});

const CONFIG = `
site: { title: Test status, timezone: UTC }
groups:
  - name: Own
    monitors:
      - { id: ci, name: CI, type: tcp, host: 127.0.0.1, port: 1, failureThreshold: 1, notify: [teams], dependsOn: [github] }
  - name: Third-party
    monitors:
      - { id: github, name: GitHub, type: provider, provider: github, notify: [teams] }
      - id: m365
        name: Microsoft 365
        type: provider
        provider: m365
        m365: { tenantId: t, clientId: c, clientSecret: super-secret }
notifiers:
  - { id: teams, type: teams, webhookUrl: "https://hooks.example/teams" }
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

describe('provider monitors in the app', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });
  const record = (
    id: string,
    status: 'up' | 'degraded' | 'down' | 'unknown',
    at: number,
    message: string = status,
  ) => h.runtime.engine.record(h.runtime.monitors.require(id), { status, latencyMs: null, message }, at);

  it('keeps third-party services out of the overall status and names them as upstream', async () => {
    h = await harness(CONFIG);
    const t = Date.now() - 10_000;
    await record('ci', 'up', t);
    await record('github', 'down', t + 1);
    const o = (await (await h.request('/api/v1/overview?days=7')).json()) as Overview;
    expect(o.status).toBe('operational');
    expect(o.total).toBe(1);
    expect(o.groups.map((g) => g.name)).toEqual(['Own']);
    expect(o.external[0]?.services.map((s) => [s.id, s.status, s.external])).toEqual([
      ['github', 'down', true],
      ['m365', 'unknown', true],
    ]);
    expect(o.groups[0]?.services[0]?.upstream).toEqual([{ id: 'github', name: 'GitHub', status: 'down' }]);

    // The own service's alert names the provider as the likely cause.
    h.sent.length = 0;
    await record('ci', 'down', t + 2, 'ECONNREFUSED');
    expect(JSON.stringify(h.sent[0]?.body)).toContain('Likely cause: GitHub is down.');

    const detail = (await (await h.request('/api/v1/services/ci?days=7')).json()) as ServiceDetail;
    expect(detail.upstream).toEqual([{ id: 'github', name: 'GitHub', status: 'down' }]);
  });

  it('does not alert when a status page becomes unreadable and alerts recovery afterwards', async () => {
    h = await harness(CONFIG);
    const t = Date.now() - 10_000;
    await record('github', 'up', t);
    await record('github', 'down', t + 1);
    expect(h.sent).toHaveLength(1);
    await record('github', 'unknown', t + 2);
    await record('github', 'down', t + 3);
    // Unknown in between: no new alert for the same outage.
    expect(h.sent).toHaveLength(1);
    await record('github', 'unknown', t + 4);
    await record('github', 'up', t + 5);
    expect(h.sent).toHaveLength(2);
    expect(JSON.stringify(h.sent[1]?.body)).toContain('GitHub recovered');
    // Unknown results stay out of the uptime: one down, one up check counted, plus the down after unknown.
    const detail = (await (await h.request('/api/v1/services/github?days=7')).json()) as ServiceDetail;
    expect(detail.checks.map((c) => c.status)).toContain('unknown');
    expect(detail.uptime).toBe(50);
  });

  it('hides the Microsoft 365 secret from the admin API and keeps it on update', async () => {
    h = await harness(CONFIG);
    const cookie = await h.login();
    const list = (await (await h.request('/api/v1/admin/monitors', { cookie })).json()) as AdminMonitor[];
    const m365 = list.find((m) => m.id === 'm365');
    expect(JSON.stringify(m365)).not.toContain('super-secret');
    expect(m365?.spec.type === 'provider' && m365.spec.m365?.clientSecret).toBe(SECRET_MASK);

    const spec = {
      id: 'o365',
      name: 'Office',
      type: 'provider',
      provider: 'm365',
      m365: { tenantId: 't', clientId: 'c', clientSecret: 's3cret' },
    };
    expect(
      (await h.request('/api/v1/admin/monitors', { method: 'POST', cookie, json: { group: 'X', spec } }))
        .status,
    ).toBe(201);
    const res = await h.request('/api/v1/admin/monitors/o365', {
      method: 'PUT',
      cookie,
      json: {
        group: 'X',
        spec: { ...spec, name: 'Office 365', m365: { ...spec.m365, clientSecret: SECRET_MASK } },
      },
    });
    expect(res.status).toBe(200);
    const stored = h.runtime.monitors.require('o365').spec;
    expect(stored.type === 'provider' && stored.m365?.clientSecret).toBe('s3cret');

    const unknownDep = await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: {
        group: 'X',
        spec: { id: 'z', name: 'Z', type: 'tcp', host: 'h', port: 1, dependsOn: ['missing'] },
      },
    });
    expect(unknownDep.status).toBe(400);
  });
});
