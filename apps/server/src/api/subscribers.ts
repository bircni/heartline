import { subscribeSchema, subscriberPrefsSchema } from '@heartline/shared';
import { type Context, Hono } from 'hono';
import { type Vars, requireScope } from '../auth/principal.ts';
import type { AppContext } from '../context.ts';
import { body } from './errors.ts';
import { rateLimit } from './rate-limit.ts';

const tokenOf = (c: Context) => c.req.header('x-subscriber-token') ?? c.req.query('t');

/**
 * Links in subscriber e-mails: confirm, manage and unsubscribe. The signed token is the credential, so they
 * work without signing in, also on private status pages. Mail scanners only follow GETs; every change here
 * is a POST, PATCH or DELETE made by the page the link opens.
 */
export function subscriberLinkRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  const limit = rateLimit(app, 'subscribe', { shared: true, bucket: () => app.config().rateLimit.subscribe });
  r.post('/subscribers/confirm', async (c) =>
    c.json(await app.subscribers.confirm(tokenOf(c) ?? (await c.req.json().catch(() => ({}))).token)),
  );
  r.get('/subscribers/me', async (c) => c.json(await app.subscribers.me(tokenOf(c))));
  r.patch('/subscribers/me', async (c) =>
    c.json(await app.subscribers.updatePrefs(tokenOf(c), await body(c, subscriberPrefsSchema))),
  );
  r.delete('/subscribers/me', async (c) => {
    await app.subscribers.unsubscribe(tokenOf(c));
    return c.body(null, 204);
  });
  // RFC 8058 one-click unsubscribe from the mail client: POST with `List-Unsubscribe=One-Click`.
  r.post('/subscribers/unsubscribe', async (c) => {
    await app.subscribers.unsubscribe(tokenOf(c));
    return c.body(null, 204);
  });
  r.post('/subscribers/manage-link', limit, async (c) => {
    const { email } = await body(c, subscribeSchema.pick({ email: true }));
    await app.subscribers.manageLink(email);
    return c.json({ ok: true }, 202);
  });
  return r;
}

/** Sign-up; behind the public gate like the status page itself. */
export function subscribeRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  // On a private status page only signed-in users (or read tokens) may sign up, like they may read it.
  const gate = requireScope('read');
  r.use('/subscribers', async (c, next) => (app.config().site.public ? next() : gate(c, next)));
  r.post(
    '/subscribers',
    rateLimit(app, 'subscribe', { shared: true, bucket: () => app.config().rateLimit.subscribe }),
    async (c) => {
      await app.subscribers.subscribe(await body(c, subscribeSchema));
      // The same answer whether or not the address was subscribed already.
      return c.json({ ok: true }, 202);
    },
  );
  return r;
}
