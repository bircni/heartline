import type { SubscriptionDto } from '@heartline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SubscriberService } from '../src/services/subscribers.ts';
import { ADMIN, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const yaml = (subscribers = '', site = '') => `
site: { title: Mail status, timezone: UTC ${site} }
groups:
  - name: Web
    monitors:
      - { id: web, name: Website, type: tcp, host: 127.0.0.1, port: 1, autoIncident: true }
      - { id: api, name: API, type: tcp, host: 127.0.0.1, port: 1 }
notifiers:
  - { id: mail, type: email, from: status@example.com, to: [ops@example.com], smtp: { host: smtp.example.com } }
subscribers:
  confirmTtl: 1h
${subscribers}
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

/** The `t` token of the first link in the latest mail to `to` that goes to `path`. */
function linkToken(to: string, path: string): string {
  const mail = h!.mails.filter((m) => m.to === to).at(-1);
  const m = mail?.text.match(new RegExp(`${path}\\?t=([^\\s&]+)`));
  if (!m?.[1]) throw new Error(`no ${path} link in mail to ${to}`);
  return decodeURIComponent(m[1]);
}

async function subscribe(email: string, extra: Record<string, unknown> = {}) {
  const res = await h!.request('/api/v1/subscribers', { method: 'POST', json: { email, ...extra } });
  expect(res.status).toBe(202);
  await h!.runtime.subscribers.dispatch();
  const confirm = await h!.request('/api/v1/subscribers/confirm', {
    method: 'POST',
    json: { token: linkToken(email, '/subscriptions/confirm') },
  });
  expect(confirm.status).toBe(200);
  return ((await confirm.json()) as { manageToken: string }).manageToken;
}

const incident = async (cookie: string, body: Record<string, unknown>) =>
  (
    await h!.request('/api/v1/admin/incidents', {
      method: 'POST',
      cookie,
      json: { message: 'Looking into it.', ...body },
    })
  ).json();

describe('subscribers', () => {
  it('sign up with double opt-in and manage their choices', async () => {
    h = await harness(yaml());
    const boot = await (await h.request('/api/v1/site')).json();
    expect(boot.subscribe).toEqual({ enabled: true, email: true, events: ['incidents', 'maintenance'] });

    await h.request('/api/v1/subscribers', { method: 'POST', json: { email: 'Ann@Example.com' } });
    await h.runtime.subscribers.dispatch();
    expect(h.mails.map((m) => [m.to, m.subject])).toEqual([
      ['ann@example.com', 'Confirm your subscription to Mail status'],
    ]);
    // Not active until confirmed.
    const cookie = await h.login();
    await incident(cookie, { title: 'Before confirming' });
    await h.runtime.subscribers.dispatch();
    expect(h.mails).toHaveLength(1);

    const { manageToken } = await (
      await h.request('/api/v1/subscribers/confirm', {
        method: 'POST',
        json: { token: linkToken('ann@example.com', '/subscriptions/confirm') },
      })
    ).json();
    const me: SubscriptionDto = await (
      await h.request('/api/v1/subscribers/me', { headers: { 'x-subscriber-token': manageToken } })
    ).json();
    expect(me).toMatchObject({
      email: 'ann@example.com',
      status: 'active',
      events: ['incidents', 'maintenance'],
      components: 'all',
    });
    expect(me.available.services.map((s) => s.id)).toEqual(['web', 'api']);

    const changed: SubscriptionDto = await (
      await h.request('/api/v1/subscribers/me', {
        method: 'PATCH',
        headers: { 'x-subscriber-token': manageToken },
        json: { events: ['incidents', 'componentStatus'], components: ['api'] },
      })
    ).json();
    // componentStatus is not offered by this site, so it is dropped.
    expect(changed).toMatchObject({ events: ['incidents'], components: ['api'] });

    // Signing up again with a subscribed address sends the manage link, with the same answer as always.
    expect(
      (await h.request('/api/v1/subscribers', { method: 'POST', json: { email: 'ann@example.com' } })).status,
    ).toBe(202);
    // Within 5 minutes of the last mail nothing more is sent; later the manage link is.
    await h.runtime.subscribers.dispatch();
    expect(h.mails.at(-1)?.subject).toBe('Confirm your subscription to Mail status');
    const later = Date.now() + 10 * 60_000;
    await h.runtime.subscribers.subscribe({ email: 'ann@example.com', components: 'all' }, later);
    await h.runtime.subscribers.dispatch(later);
    expect(h.mails.at(-1)?.subject).toBe('Your subscription to Mail status');
    expect(
      (await h.request('/api/v1/subscribers', { method: 'POST', json: { email: 'not-an-email' } })).status,
    ).toBe(400);
  });

  it('reject tampered, expired and stale links', async () => {
    h = await harness(yaml());
    await h.request('/api/v1/subscribers', { method: 'POST', json: { email: 'bob@example.com' } });
    await h.runtime.subscribers.dispatch();
    const token = linkToken('bob@example.com', '/subscriptions/confirm');
    const [payload, sig] = token.split('.');
    const forged = `${Buffer.from(Buffer.from(payload!, 'base64url').toString().replace('confirm', 'manage')).toString('base64url')}.${sig}`;
    expect(
      (await h.request('/api/v1/subscribers/me', { headers: { 'x-subscriber-token': forged } })).status,
    ).toBe(400);
    await expect(h.runtime.subscribers.confirm(token, Date.now() + 2 * 3_600_000)).rejects.toThrow(/expired/);

    const { manageToken } = await h.runtime.subscribers.confirm(token);
    expect(
      (
        await h.request(`/api/v1/subscribers/unsubscribe?t=${encodeURIComponent(manageToken)}`, {
          method: 'POST',
        })
      ).status,
    ).toBe(204);
    // Unsubscribing invalidates every earlier link.
    expect(
      (await h.request('/api/v1/subscribers/me', { headers: { 'x-subscriber-token': manageToken } })).status,
    ).toBe(400);
  });

  it('get e-mails for the incidents, services and events they chose', async () => {
    h = await harness(yaml('  events: { automaticIncidents: true }'));
    const cookie = await h.login();
    await subscribe('all@example.com');
    await subscribe('api@example.com', { components: ['api'] });
    await subscribe('auto@example.com', { events: ['automaticIncidents'] });
    h.mails.length = 0;

    await incident(cookie, { title: 'Web slow', services: ['web'], notify: true });
    await incident(cookie, { title: 'Quiet one', services: ['api'], notify: false });
    await incident(cookie, { title: 'Everything', notify: true });
    const web = h.runtime.monitors.require('web');
    await h.runtime.engine.record(web, { status: 'down', latencyMs: null, message: 'refused' });
    await h.runtime.engine.record(
      web,
      { status: 'down', latencyMs: null, message: 'refused' },
      Date.now() + 1,
    );
    await h.runtime.subscribers.dispatch();

    const got = (to: string) => h!.mails.filter((m) => m.to === to).map((m) => m.subject);
    // `all` chose every offered event, automatic incidents included.
    expect(got('all@example.com').toSorted()).toEqual(['Everything', 'Web slow', 'Website is unavailable']);
    expect(got('api@example.com')).toEqual(['Everything']);
    expect(got('auto@example.com')).toEqual(['Website is unavailable']);
    const mail = h.mails.find((m) => m.subject === 'Web slow')!;
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.html).toContain('Looking into it.');
    expect(mail.text).toContain('/subscriptions/manage?t=');
  });

  it('follow one incident, and hear about maintenance', async () => {
    h = await harness(yaml());
    const cookie = await h.login();
    const i = await incident(cookie, { title: 'Database', services: ['api'], notify: false });
    await subscribe('fan@example.com', { events: ['maintenance'], incidentId: i.id });
    h.mails.length = 0;
    await h.request(`/api/v1/admin/incidents/${i.id}/updates`, {
      method: 'POST',
      cookie,
      json: { status: 'resolved', message: 'Fixed.' },
    });
    const now = Date.now();
    await h.request('/api/v1/admin/maintenance', {
      method: 'POST',
      cookie,
      json: {
        title: 'Upgrade',
        startsAt: new Date(now + 86_400_000).toISOString(),
        endsAt: new Date(now + 90_000_000).toISOString(),
      },
    });
    await h.runtime.subscribers.dispatch();
    expect(h.mails.map((m) => m.subject)).toEqual(['Resolved: Database', 'Scheduled maintenance: Upgrade']);
  });

  it('send at most ratePerMinute, retry failures and never twice', async () => {
    h = await harness(yaml('  email: { ratePerMinute: 2 }'));
    const cookie = await h.login();
    const s = h.runtime.subscribers;
    for (const n of [1, 2, 3]) {
      await h.request('/api/v1/subscribers', { method: 'POST', json: { email: `u${n}@example.com` } });
    }
    const t = Date.now() + 1000;
    await s.dispatch(t);
    expect(h.mails).toHaveLength(2);
    await s.dispatch(t + 30_000);
    expect(h.mails).toHaveLength(3);
    for (const n of [1, 2, 3]) await s.confirm(linkToken(`u${n}@example.com`, '/subscriptions/confirm'));
    h.mails.length = 0;

    await incident(cookie, { title: 'Flaky mail server', notify: true });
    h.failMail('connection refused');
    await s.dispatch(t + 120_000);
    expect(h.mails).toHaveLength(0);
    // Two attempts fit in the rate; both failed.
    expect((await s.list()).filter((x) => x.lastError === 'connection refused')).toHaveLength(2);
    h.failMail(null);
    // Half a minute later one more fits: the e-mail not tried yet. The failed ones wait for their backoff.
    await s.dispatch(t + 150_000);
    expect(h.mails).toHaveLength(1);
    // A second sender on the same database: each e-mail still goes out once.
    const other = new SubscriberService({
      db: h.runtime.db,
      secret: 'x'.repeat(32),
      baseUrl: 'http://x',
      monitors: h.runtime.monitors,
      transportFactory: () => ({
        sendMail: async (m) => void h!.mails.push({ ...m, to: `${m.to} (other)` }),
      }),
    });
    other.settings = s.settings;
    await Promise.all([s.dispatch(t + 300_000), other.dispatch(t + 300_000)]);
    await Promise.all([s.dispatch(t + 400_000), other.dispatch(t + 400_000)]);
    expect(h.mails.map((m) => m.to.replace(' (other)', '')).toSorted()).toEqual([
      'u1@example.com',
      'u2@example.com',
      'u3@example.com',
    ]);
  });

  it('need sign-in to sign up on a private site, but the e-mail links still work', async () => {
    h = await harness(yaml('', ', public: false'));
    expect(
      (await h.request('/api/v1/subscribers', { method: 'POST', json: { email: 'x@example.com' } })).status,
    ).toBe(401);
    const cookie = await h.login();
    expect(
      (await h.request('/api/v1/subscribers', { method: 'POST', cookie, json: { email: 'x@example.com' } }))
        .status,
    ).toBe(202);
    await h.runtime.subscribers.dispatch();
    const confirm = await h.request('/api/v1/subscribers/confirm', {
      method: 'POST',
      json: { token: linkToken('x@example.com', '/subscriptions/confirm') },
    });
    expect(confirm.status).toBe(200);
  });

  it('are listed and removed by admins', async () => {
    h = await harness(yaml());
    await subscribe('gone@example.com');
    const cookie = await h.login();
    const list = await (await h.request('/api/v1/admin/subscribers', { cookie })).json();
    expect(list).toMatchObject([{ email: 'gone@example.com', status: 'active', components: 'all' }]);
    expect(
      (await h.request(`/api/v1/admin/subscribers/${list[0].id}`, { method: 'DELETE', cookie })).status,
    ).toBe(204);
    expect(await (await h.request('/api/v1/admin/subscribers', { cookie })).json()).toEqual([]);
  });

  it('turn e-mail off without a mail server', async () => {
    h = await harness(yaml().replace(/notifiers:\n.*\n/, ''));
    expect((await (await h.request('/api/v1/site')).json()).subscribe.email).toBe(false);
    expect(
      (await h.request('/api/v1/subscribers', { method: 'POST', json: { email: 'x@example.com' } })).status,
    ).toBe(400);
  });
});

describe('feeds', () => {
  it('list incidents and maintenance with their whole timeline', async () => {
    h = await harness(yaml());
    const cookie = await h.login();
    const i = await incident(cookie, {
      title: 'Broken <thing>',
      message: 'First **bold** update',
      services: ['web'],
      notify: false,
    });
    await h.request(`/api/v1/admin/incidents/${i.id}/updates`, {
      method: 'POST',
      cookie,
      json: { status: 'resolved', message: 'Done', notify: false },
    });
    const now = Date.now();
    await h.request('/api/v1/admin/maintenance', {
      method: 'POST',
      cookie,
      json: {
        title: 'Patch day',
        startsAt: new Date(now + 86_400_000).toISOString(),
        endsAt: new Date(now + 90_000_000).toISOString(),
        notify: false,
      },
    });
    const atom = await (await h.request('/api/v1/incidents.atom')).text();
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(atom).toContain(`<id>urn:uuid:${i.id}</id>`);
    expect(atom).toContain('<title>Broken &lt;thing&gt; (Resolved)</title>');
    expect(atom).toContain('&lt;strong&gt;bold&lt;/strong&gt;');
    expect(atom).toContain('Done');
    expect(atom).toContain('Maintenance: Patch day (Scheduled)');
    const rss = await (await h.request('/api/v1/incidents.rss')).text();
    expect(rss).toContain('Maintenance: Patch day');
  });
});
