import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Overview, ServiceDetail, SoftwareDetail, SoftwareInventory } from '@heartline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config/load.ts';
import { interpretPluginOutput } from '../src/checks/plugins.ts';
import { type Harness, ADMIN, harness } from './helpers.ts';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/intel/${name}`, import.meta.url)), 'utf8');

/** Routes intel requests to fixtures; `fail` makes every source unreachable. */
function intelFetch(state: { fail: boolean; calls: string[] }) {
  return async (url: string | URL | Request): Promise<Response | undefined> => {
    const u = new URL(String(url));
    if (!['api.osv.dev', 'services.nvd.nist.gov', 'endoflife.date', 'www.cisa.gov'].includes(u.hostname))
      return undefined;
    state.calls.push(u.hostname + u.pathname);
    if (state.fail) return new Response('nope', { status: 503 });
    const json = (body: string) =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'api.osv.dev') return json(fixture('osv-query-gitea.json'));
    if (u.hostname === 'services.nvd.nist.gov') return json(fixture('nvd-gitea.json'));
    if (u.hostname === 'endoflife.date') return json(fixture('eol-gitea.json'));
    return json(fixture('kev.json'));
  };
}

const CONFIG = (extra = '') => `
site: { title: Test status, timezone: UTC${extra} }
groups:
  - name: Code
    monitors:
      - id: git
        name: Gitea
        type: http
        url: "http://127.0.0.1:1/"
        notify: [teams]
        software: { product: gitea, version: { static: "1.22.0" } }
      - id: plain
        name: Plain
        type: tcp
        host: 127.0.0.1
        port: 1
notifiers:
  - { id: teams, type: teams, webhookUrl: "https://hooks.example/teams" }
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

let h: Harness;
const state = { fail: false, calls: [] as string[] };
beforeEach(async () => {
  state.fail = false;
  state.calls = [];
  h = await harness(CONFIG(), { fetchImpl: intelFetch(state), env: { nvdApiKey: 'test-key' } });
});
afterEach(async () => {
  await h.close();
});

describe('software inventory', () => {
  it('probes a static version, looks up intel and scores urgency', async () => {
    const cookie = await h.login();
    const res = await h.request('/api/v1/admin/monitors/git/software/refresh', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const d = (await res.json()) as SoftwareDetail;
    expect(d).toMatchObject({
      serviceId: 'git',
      product: 'gitea',
      productName: 'Gitea',
      version: '1.22.0',
      versionSource: 'static',
      latest: '1.24.6',
      latestInCycle: '1.22.6',
      cycle: '1.22',
      eol: '2025-03-01',
      eolReached: true,
      urgency: 'critical',
      intelError: null,
    });
    expect(d.vulnerabilities.map((v) => v.id)).toEqual(['CVE-2025-10001', 'GO-2025-4242']);
    expect(d.vulnerabilities[0]).toMatchObject({
      kev: true,
      score: 9.8,
      severity: 'critical',
      fixedIn: '1.22.3',
      sources: ['osv', 'nvd'],
      urls: { nvd: 'https://nvd.nist.gov/vuln/detail/CVE-2025-10001' },
    });
    expect(d.vulns).toEqual({ critical: 1, high: 0, medium: 1, low: 0, unknown: 0 });
    expect(d.reasons[0]).toBe('CVE-2025-10001 (CVSS 9.8, actively exploited) fixed in 1.22.3');
    expect(d.reasons).toContain('release cycle 1.22 is end-of-life since 2025-03-01');
    expect(state.calls).toEqual(
      expect.arrayContaining([
        'endoflife.date/api/gitea.json',
        'api.osv.dev/v1/query',
        'services.nvd.nist.gov/rest/json/cves/2.0',
      ]),
    );

    // One notification for the new critical findings, none on the next (unchanged) refresh.
    const notifications = h.sent.filter((s) => s.url === 'https://hooks.example/teams');
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications[0]?.body)).toContain('Gitea: 2 new vulnerabilities (critical)');
    state.calls = [];
    await h.request('/api/v1/admin/monitors/git/software/refresh', { method: 'POST', cookie });
    expect(h.sent.filter((s) => s.url === 'https://hooks.example/teams')).toHaveLength(1);

    const inv = (await (await h.request('/api/v1/software', { cookie })).json()) as SoftwareInventory;
    expect(inv.totals.critical).toBe(1);
    expect(inv.services).toHaveLength(1);
    expect(inv.services[0]).toMatchObject({ serviceId: 'git', urgency: 'critical' });
    expect(inv.services[0]).not.toHaveProperty('vulnerabilities');

    const csv = await (await h.request('/api/v1/software/report.csv', { cookie })).text();
    expect(csv.split('\n')[0]).toBe(
      'service,product,version,latest,cycle,eol,urgency,score,critical,high,medium,low,unknown,top_reason',
    );
    expect(csv).toContain('git,gitea,1.22.0,1.24.6,1.22,2025-03-01,critical');

    const o = (await (await h.request('/api/v1/overview?days=7', { cookie })).json()) as Overview;
    expect(o.security).toEqual({ critical: 1, high: 0 });
    expect(o.groups[0]?.services[0]?.software).toMatchObject({ version: '1.22.0', urgency: 'critical' });
    expect(o.groups[0]?.services[1]?.software).toBeNull();
  });

  it('hides everything from anonymous visitors unless showVersions is on, and never shows vulnerabilities', async () => {
    const cookie = await h.login();
    await h.request('/api/v1/admin/monitors/git/software/refresh', { method: 'POST', cookie });

    expect((await h.request('/api/v1/software')).status).toBe(401);
    expect((await h.request('/api/v1/services/git/software')).status).toBe(401);
    let d = (await (await h.request('/api/v1/services/git?days=7')).json()) as ServiceDetail;
    expect(d.software).toBeNull();
    let o = (await (await h.request('/api/v1/overview?days=7')).json()) as Overview;
    expect(o.security).toBeNull();

    await h.runtime.applyConfig(parseConfig(CONFIG(', showVersions: true'), {}));
    d = (await (await h.request('/api/v1/services/git?days=7')).json()) as ServiceDetail;
    expect(d.software).toMatchObject({
      version: '1.22.0',
      latest: '1.24.6',
      urgency: null,
      score: null,
      vulns: null,
    });
    const sw = (await (await h.request('/api/v1/services/git/software')).json()) as SoftwareDetail;
    expect(sw.vulnerabilities).toEqual([]);
    expect(sw.reasons).toEqual([]);
    const inv = (await (await h.request('/api/v1/software')).json()) as SoftwareInventory;
    expect(inv.services[0]?.urgency).toBeNull();
    o = (await (await h.request('/api/v1/overview?days=7')).json()) as Overview;
    expect(o.security).toBeNull();
    expect(o.groups[0]?.services[0]?.software?.urgency).toBeNull();

    const badge = await h.request('/api/v1/badge/git.svg?kind=version');
    expect(badge.status).toBe(200);
    expect(await badge.text()).toContain('v1.22.0');

    // Signed in: everything.
    const full = (await (
      await h.request('/api/v1/services/git/software', { cookie })
    ).json()) as SoftwareDetail;
    expect(full.vulnerabilities).toHaveLength(2);
  });

  it('degrades to unknown when the sources are unreachable and keeps old findings', async () => {
    const cookie = await h.login();
    await h.request('/api/v1/admin/monitors/git/software/refresh', { method: 'POST', cookie });
    state.fail = true;
    // Fresh monitor without cached intel: everything fails.
    await h.runtime.applyConfig(
      parseConfig(
        CONFIG().replace(
          '      - id: plain',
          '      - { id: new, name: New, type: http, url: "http://127.0.0.1:1/", software: { product: gitea, version: { static: "1.23.1" } } }\n      - id: plain',
        ),
        {},
      ),
    );
    const res = await h.request('/api/v1/admin/monitors/new/software/refresh', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    const d = (await res.json()) as SoftwareDetail;
    expect(d.urgency).toBe('unknown');
    expect(d.intelError).toMatch(/osv: HTTP 503/);
    expect(d.reasons[0]).toBe('vulnerability data unavailable');
    // The already-known service keeps its findings from the cache.
    const old = (await (
      await h.request('/api/v1/admin/monitors/git/software/refresh', { method: 'POST', cookie })
    ).json()) as SoftwareDetail;
    expect(old.vulnerabilities).toHaveLength(2);
    expect(old.urgency).toBe('critical');
  });

  it('announces version changes and refreshes immediately', async () => {
    const cookie = await h.login();
    await h.request('/api/v1/admin/monitors/git/software/refresh', { method: 'POST', cookie });
    const before = h.sent.length;
    await h.runtime.software.observeVersion('git', '1.22.6', 'probe', null);
    const texts = h.sent.slice(before).map((s) => JSON.stringify(s.body));
    expect(texts.some((t) => t.includes('Gitea updated to 1.22.6'))).toBe(true);
    const d = (await (await h.request('/api/v1/services/git/software', { cookie })).json()) as SoftwareDetail;
    expect(d).toMatchObject({ version: '1.22.6', previousVersion: '1.22.0', versionSource: 'probe' });
    // 1.22.6 is past every fix in the fixtures: no vulnerabilities, but the cycle is end-of-life.
    expect(d.vulnerabilities).toEqual([]);
    expect(d.urgency).toBe('medium');
  });

  it('rejects refreshes for services without a software block', async () => {
    const cookie = await h.login();
    const res = await h.request('/api/v1/admin/monitors/plain/software/refresh', { method: 'POST', cookie });
    expect(res.status).toBe(400);
    expect((await h.request('/api/v1/services/plain/software', { cookie })).status).toBe(404);
    const catalog = (await (await h.request('/api/v1/admin/software/catalog', { cookie })).json()) as {
      slug: string;
    }[];
    expect(catalog.some((c) => c.slug === 'gitea')).toBe(true);
    const queued = await h.request('/api/v1/admin/software/refresh', { method: 'POST', cookie });
    expect(queued.status).toBe(202);
  });
});

describe('version extraction in checks', () => {
  let http: Server;
  let base: string;
  beforeEach(async () => {
    http = createServer((req, res) => {
      res.setHeader('x-app-version', 'v3.4.5');
      if (req.url === '/api/version' || req.url === '/api/v1/version') return res.end('{"version":"1.24.3"}');
      res.end('ok');
    }).listen(0, '127.0.0.1');
    await once(http, 'listening');
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterEach(() => http.close());

  it('reads inline versions from the check response and separate probes from the catalog path', async () => {
    const cookie = await h.login();
    const create = async (id: string, software: unknown) =>
      h.request('/api/v1/admin/monitors', {
        method: 'POST',
        cookie,
        json: { group: 'Code', spec: { id, name: id, type: 'http', url: `${base}/`, software } },
      });
    expect(
      (await create('inline', { product: 'custom-app', version: { header: 'x-app-version' } })).status,
    ).toBe(201);
    expect(
      (
        await create('probed', {
          product: 'custom-app',
          version: { url: `${base}/api/version`, json: 'version' },
        })
      ).status,
    ).toBe(201);
    expect((await create('cat', { product: 'gitea' })).status).toBe(201);

    const outcome = await h.runtime.scheduler.runNow(h.runtime.monitors.require('inline'));
    expect(outcome?.version).toBe('3.4.5');
    let d = (await (
      await h.request('/api/v1/services/inline/software', { cookie })
    ).json()) as SoftwareDetail;
    expect(d).toMatchObject({ version: '3.4.5', versionSource: 'check' });

    await h.runtime.software.probeNow(h.runtime.monitors.require('probed'));
    d = (await (await h.request('/api/v1/services/probed/software', { cookie })).json()) as SoftwareDetail;
    expect(d).toMatchObject({ version: '1.24.3', versionSource: 'probe', probeError: null });

    await h.runtime.software.probeNow(h.runtime.monitors.require('cat'));
    d = (await (await h.request('/api/v1/services/cat/software', { cookie })).json()) as SoftwareDetail;
    expect(d).toMatchObject({ version: '1.24.3', versionSource: 'probe' });
    expect(d.urgency).toBe('low');
    expect(d.reasons).toEqual(['3 patch releases behind (1.24.3 → 1.24.6)']);
  });

  it('accepts a version from plugin output', () => {
    expect(interpretPluginOutput(0, '{"status":"up","version":"v16.2"}', '', 5)).toEqual({
      status: 'up',
      latencyMs: 5,
      message: null,
      version: '16.2',
    });
    expect(interpretPluginOutput(0, '{"status":"up"}', '', 5)).not.toHaveProperty('version');
  });
});
