import { Hono } from 'hono';
import type { Vars } from '../auth/principal.ts';
import type { AppContext } from '../context.ts';
import { parsePush } from '../services/push.ts';
import { log } from '../util/log.ts';
import { rateLimit } from './rate-limit.ts';

/**
 * `GET|POST /api/v1/push/:token`: a push monitor reports in. The secret in the URL is the credential, so it
 * works without signing in, also on private status pages. Unknown tokens get the same answer every time.
 */
export function pushRoutes(app: AppContext) {
  const r = new Hono<Vars>();
  r.use('/push/*', rateLimit(app, 'push', { shared: true, bucket: () => app.config().rateLimit.push }));
  r.on(['GET', 'POST', 'PUT'], '/push/:token', async (c) => {
    const monitor = await app.push.resolve(c.req.param('token'));
    if (!monitor) return c.json({ error: 'not found' }, 404);
    let body: unknown = null;
    if (c.req.method !== 'GET') {
      const type = c.req.header('content-type') ?? '';
      if (type.includes('application/json')) body = await c.req.json().catch(() => null);
      else if (type.includes('form'))
        body = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
    }
    const outcome = parsePush(c.req.query(), body);
    if (monitor.paused) return c.json({ ok: true, ignored: 'paused' }, 202);
    const at = Date.now();
    await app.push.touch(monitor.id, outcome.status, at);
    await app.scheduler.ingest(monitor, outcome, at);
    log.debug('push received', { service: monitor.id, status: outcome.status });
    return c.json({ ok: true, status: outcome.status });
  });
  return r;
}
