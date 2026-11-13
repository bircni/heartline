import type { AuditEntryDto } from '@heartline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/api/rate-limit.ts';
import { openDb } from '../src/db/index.ts';
import { migrate } from '../src/db/migrations.ts';
import { redact } from '../src/services/audit.ts';
import { BASE_CONFIG, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const audit = async (cookie: string, query = ''): Promise<AuditEntryDto[]> =>
  (await h!.request(`/api/v1/admin/audit${query}`, { cookie })).json();

describe('audit log', () => {
  it('records who changed what, without secrets', async () => {
    h = await harness();
    const cookie = await h.login();
    const created = await h.request('/api/v1/admin/monitors', {
      method: 'POST',
      cookie,
      json: {
        group: 'X',
        spec: {
          id: 'secret-http',
          name: 'Secret',
          type: 'http',
          url: 'http://127.0.0.1:1/',
          headers: { Authorization: 'Bearer hunter2' },
        },
      },
    });
    expect(created.status).toBe(201);
    await h.request('/api/v1/admin/monitors/secret-http/pause', {
      method: 'POST',
      cookie,
      json: { paused: true },
    });
    const incident = await (
      await h.request('/api/v1/admin/incidents', {
        method: 'POST',
        cookie,
        json: { title: 'Slow', message: 'Looking', services: ['web'], notify: false },
      })
    ).json();
    await h.request(`/api/v1/admin/incidents/${incident.id}`, { method: 'DELETE', cookie });
    const token = await (
      await h.request('/api/v1/admin/tokens', {
        method: 'POST',
        cookie,
        json: { name: 'ci', scopes: ['read'] },
      })
    ).json();
    await h.request(`/api/v1/admin/monitors/secret-http`, { method: 'DELETE', cookie });

    const entries = await audit(cookie);
    expect(entries.map((e) => e.action)).toEqual([
      'monitor.delete',
      'token.create',
      'incident.delete',
      'incident.create',
      'monitor.pause',
      'monitor.create',
      // The monitor named a group that did not exist yet.
      'group.create',
    ]);
    expect(entries.every((e) => e.actor.name === 'Admin' && e.actor.via === 'session')).toBe(true);
    const all = JSON.stringify(entries);
    expect(all).not.toContain('hunter2');
    expect(all).not.toContain(token.token);
    expect(entries.find((e) => e.action === 'incident.delete')?.summary).toBe('Deleted incident “Slow”');

    const monitorsOnly = await audit(cookie, '?entityType=monitor&entityId=secret-http');
    expect(monitorsOnly).toHaveLength(3);
    const older = await audit(cookie, `?before=${entries[2]!.at}&limit=1`);
    expect(older).toHaveLength(1);
    expect(older[0]!.at).toBeLessThan(entries[2]!.at);
  });

  it('records automatic incidents as system actions and is admin-only', async () => {
    h = await harness();
    const web = h.runtime.monitors.require('web');
    const t = Date.now();
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'HTTP 502' }, t);
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'HTTP 502' }, t + 1);
    await h.runtime.engine.record(web, { status: 'up', latencyMs: 10, message: 'ok' }, t + 2);
    const cookie = await h.login();
    const entries = await audit(cookie);
    expect(entries.map((e) => [e.action, e.actor.via])).toEqual([
      ['incident.auto_resolve', 'system'],
      ['incident.auto_open', 'system'],
    ]);

    const { token } = await (
      await h.request('/api/v1/admin/tokens', {
        method: 'POST',
        cookie,
        json: { name: 'r', scopes: ['read'] },
      })
    ).json();
    expect((await h.request('/api/v1/admin/audit', { token })).status).toBe(403);
  });

  it('prunes entries older than the retention', async () => {
    h = await harness();
    const now = Date.now();
    await h.runtime.audit.record(
      { kind: 'system' },
      { action: 'a.old', entityType: 'x', summary: 'old' },
      now - 400 * 86_400_000,
    );
    await h.runtime.audit.record(
      { kind: 'system' },
      { action: 'a.new', entityType: 'x', summary: 'new' },
      now,
    );
    expect(await h.runtime.audit.prune(365, now)).toBe(1);
    expect((await h.runtime.audit.list()).map((e) => e.action)).toEqual(['a.new']);
  });

  it('redacts credential-looking keys at any depth', () => {
    expect(
      redact({
        a: 1,
        password: 'x',
        nested: [{ apiKey: 'k', clientSecret: 's', token: '' }],
        headers: { Cookie: 'c' },
      }),
    ).toEqual({
      a: 1,
      password: '[redacted]',
      nested: [{ apiKey: '[redacted]', clientSecret: '[redacted]', token: '' }],
      headers: { Cookie: '[redacted]' },
    });
  });
});

describe('rate limiting', () => {
  const limited = (yaml: string) => BASE_CONFIG + `rateLimit:\n  ${yaml}\n`;

  it('limits anonymous reads but not signed-in users', async () => {
    h = await harness(limited('public: { max: 3, window: 1m }'));
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await h.request('/api/v1/overview')).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    const blocked = await h.request('/api/v1/overview');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(/Too many requests/);
    const cookie = await h.login();
    expect((await h.request('/api/v1/overview', { cookie })).status).toBe(200);
  });

  it('limits sign-in attempts per client IP', async () => {
    h = await harness(limited('auth: { max: 2, window: 1m }\n  trustProxy: true'));
    const attempt = (ip: string) =>
      h!.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
        json: { email: 'admin@test.local', password: 'wrong-password-123' },
      });
    expect((await attempt('10.0.0.1')).status).toBe(401);
    expect((await attempt('10.0.0.1')).status).toBe(401);
    expect((await attempt('10.0.0.1')).status).toBe(429);
    // Another client is not affected.
    expect((await attempt('10.0.0.2')).status).toBe(401);
  });

  it('can be switched off', async () => {
    h = await harness(limited('enabled: false\n  public: { max: 1, window: 1m }'));
    expect((await h.request('/api/v1/overview')).status).toBe(200);
    expect((await h.request('/api/v1/overview')).status).toBe(200);
  });

  it('shares strict buckets between replicas on one database and resets with the window', async () => {
    const db = openDb('sqlite::memory:');
    await migrate(db.kysely);
    const a = new RateLimiter(db);
    const b = new RateLimiter(db);
    const bucket = { max: 2, window: 60_000 };
    const t = 1_700_000_000_000;
    expect(await a.take(a.shared, 'auth:1.2.3.4', bucket, t)).toBeNull();
    expect(await b.take(b.shared, 'auth:1.2.3.4', bucket, t + 1)).toBeNull();
    expect(await a.take(a.shared, 'auth:1.2.3.4', bucket, t + 2)).toBeGreaterThan(0);
    // Memory buckets are per replica.
    expect(await b.take(b.memory, 'public:1.2.3.4', { max: 1, window: 60_000 }, t)).toBeNull();
    expect(await a.take(a.memory, 'public:1.2.3.4', { max: 1, window: 60_000 }, t)).toBeNull();
    // A new window starts from zero.
    expect(await a.take(a.shared, 'auth:1.2.3.4', bucket, t + 60_000)).toBeNull();
    await a.prune(60_000, t + 10 * 60_000);
    expect(await db.kysely.selectFrom('rate_limits').selectAll().execute()).toEqual([]);
    await db.close();
  });
});
