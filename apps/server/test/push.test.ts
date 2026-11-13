import type { AdminMonitor, Overview } from '@heartline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePush } from '../src/services/push.ts';
import { ADMIN, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const yaml = (extra = '', site = '') => `
site: { title: Push, timezone: UTC ${site} }
groups:
  - name: Jobs
    monitors:
      - { id: backup, name: Nightly backup, type: push, interval: 1h, grace: 10m, autoIncident: true, token: "fixed-token-for-the-backup-job" }
      - { id: alerts, name: Alertmanager, type: push, heartbeat: false }
${extra}
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

const statusOf = async (id: string) => {
  const o: Overview = await (
    await h!.request('/api/v1/overview?days=1', { cookie: await h!.login() })
  ).json();
  return o.groups.flatMap((g) => g.services).find((s) => s.id === id)?.status;
};

describe('push payloads', () => {
  it('read heartbeats, Alertmanager and Grafana', () => {
    expect(parsePush({}, null)).toEqual({ status: 'up', latencyMs: null, message: null });
    expect(parsePush({ status: 'down', msg: 'disk full', latencyMs: '12.6' }, null)).toEqual({
      status: 'down',
      latencyMs: 13,
      message: 'disk full',
    });
    expect(parsePush({}, { status: 'firing', commonAnnotations: { summary: 'API 5xx' } })).toMatchObject({
      status: 'down',
      message: 'API 5xx',
    });
    expect(parsePush({}, { state: 'ok', title: 'All good' })).toMatchObject({
      status: 'up',
      message: 'All good',
    });
    expect(parsePush({ version: '1.4.2' }, { status: 'warning' })).toMatchObject({
      status: 'degraded',
      version: '1.4.2',
    });
    expect(() => parsePush({ status: 'sideways' }, null)).toThrow(/unknown status/);
  });
});

describe('push monitors', () => {
  it('turn a heartbeat into a check, and go down when it is overdue', async () => {
    h = await harness(yaml());
    const backup = h.runtime.monitors.require('backup');
    const push = (q = '') => h!.request(`/api/v1/push/fixed-token-for-the-backup-job${q}`);
    expect(await (await push()).json()).toEqual({ ok: true, status: 'up' });
    expect(await statusOf('backup')).toBe('operational');

    const t = Date.now();
    // On time: nothing recorded.
    let w = await h.runtime.push.watchdog(backup, t + 30 * 60_000);
    expect(w.record).toBe(false);
    // Overdue after interval + grace.
    w = await h.runtime.push.watchdog(backup, t + 71 * 60_000);
    expect(w).toMatchObject({ record: true, outcome: { status: 'down' } });
    await h.runtime.engine.record(backup, w.outcome, t + 71 * 60_000);
    expect(await statusOf('backup')).toBe('down');
    expect((await h.runtime.incidents.openAutomatic('backup'))?.title).toBe('Nightly backup is unavailable');

    // The next heartbeat recovers it.
    await push('?msg=done%20in%2042s&latencyMs=42000');
    expect(await statusOf('backup')).toBe('operational');
  });

  it('keep the last status a webhook sent', async () => {
    h = await harness(yaml());
    const cookie = await h.login();
    const { url } = await (
      await h.request('/api/v1/admin/monitors/alerts/push-token', { method: 'POST', cookie })
    ).json();
    const path = new URL(url).pathname;
    const send = (body: unknown) => h!.request(path, { method: 'POST', json: body });
    expect((await send({ status: 'firing', commonAnnotations: { summary: 'High error rate' } })).status).toBe(
      200,
    );
    expect(await statusOf('alerts')).toBe('down');
    const w = await h.runtime.push.watchdog(h.runtime.monitors.require('alerts'), Date.now() + 86_400_000);
    // The scheduler never watches webhook monitors; their status stays until the next push.
    expect(w.outcome.status).toBe('down');
    await send({ status: 'resolved' });
    expect(await statusOf('alerts')).toBe('operational');
  });

  it('give new monitors a URL once, rotate it, and refuse unknown, fixed and paused ones', async () => {
    h = await harness(yaml());
    const cookie = await h.login();
    const created: AdminMonitor = await (
      await h.request('/api/v1/admin/monitors', {
        method: 'POST',
        cookie,
        json: { group: 'Jobs', spec: { id: 'sync', name: 'Sync', type: 'push', interval: '10m' } },
      })
    ).json();
    expect(created.pushUrl).toMatch(/\/api\/v1\/push\/hlp_/);
    expect(created.push?.prefix).toBe(
      new URL(created.pushUrl as string).pathname.split('/').at(-1)!.slice(0, 10),
    );
    const list: AdminMonitor[] = await (await h.request('/api/v1/admin/monitors', { cookie })).json();
    expect(list.find((m) => m.id === 'sync')).not.toHaveProperty('pushUrl');
    expect(JSON.stringify(list)).not.toContain('fixed-token-for-the-backup-job');

    const first = new URL(created.pushUrl as string).pathname;
    expect((await h.request(first)).status).toBe(200);
    const rotated = await (
      await h.request('/api/v1/admin/monitors/sync/push-token', { method: 'POST', cookie })
    ).json();
    expect((await h.request(first)).status).toBe(404);
    expect((await h.request(new URL(rotated.url).pathname)).status).toBe(200);
    expect(
      (await h.request('/api/v1/admin/monitors/backup/push-token', { method: 'POST', cookie })).status,
    ).toBe(409);
    expect((await h.request('/api/v1/push/hlp_nonsense')).status).toBe(404);

    await h.request('/api/v1/admin/monitors/sync/pause', { method: 'POST', cookie, json: { paused: true } });
    expect((await h.request(new URL(rotated.url).pathname)).status).toBe(202);
    expect((await h.request(`${new URL(rotated.url).pathname}?status=sideways`)).status).toBe(400);
  });

  it('accept pushes on a private site and limit them per address', async () => {
    h = await harness(yaml('rateLimit:\n  push: { max: 2, window: 1m }', ', public: false'));
    expect((await h.request('/api/v1/overview')).status).toBe(401);
    const path = '/api/v1/push/fixed-token-for-the-backup-job';
    expect((await h.request(path)).status).toBe(200);
    expect((await h.request(path)).status).toBe(200);
    expect((await h.request(path)).status).toBe(429);
  });
});
