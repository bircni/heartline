import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { adminRoutes } from './api/admin.ts';
import { onError } from './api/errors.ts';
import { rateLimit } from './api/rate-limit.ts';
import { docsHtml, openApiDocument } from './api/openapi.ts';
import { bootstrapRoutes, publicRoutes } from './api/public.ts';
import { pushRoutes } from './api/push.ts';
import { type Vars, principalMiddleware } from './auth/principal.ts';
import type { AppContext } from './context.ts';
import { mcpHandler } from './mcp/server.ts';

/** better-auth endpoints that take a password or create a client: sign-in, sign-up and client registration. */
const AUTH_LIMITED = /^\/api\/auth\/(sign-in|sign-up|oauth2\/register|mcp\/register)(\/|$)/;

export function createApp(app: AppContext) {
  const h = new Hono<Vars>();
  h.onError(onError);
  h.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'", 'https:', 'http:'],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  h.get('/healthz', (c) => c.json({ ok: true }));
  h.get('/readyz', async (c) => {
    try {
      await app.db.kysely.selectFrom('monitors').select('id').limit(1).execute();
      return c.json({ ok: true, leader: app.scheduler.isLeader });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  // Sign-in and OAuth client registration: a shared limit per IP against password guessing and spam.
  const authLimit = rateLimit(app, 'auth', { shared: true });
  h.use('/api/auth/*', async (c, next) =>
    c.req.method === 'POST' && AUTH_LIMITED.test(c.req.path) ? authLimit(c, next) : next(),
  );
  // better-auth: sessions, OAuth logins, the OAuth 2.1 provider for MCP and its discovery documents.
  h.on(['GET', 'POST'], '/api/auth/*', (c) => app.auth.handler(c.req.raw));
  h.on(['GET', 'HEAD'], '/.well-known/*', (c) => app.auth.handler(c.req.raw));

  const mcp = mcpHandler(app);
  h.on(['GET', 'POST', 'DELETE'], '/mcp', (c) => mcp(c.req.raw));

  let openapi: Record<string, unknown> | null = null;
  const doc = () => (openapi ??= openApiDocument(app.env.baseUrl));
  h.get('/api/v1/openapi.json', (c) => c.json(doc()));
  h.get('/api/docs', (c) => c.html(docsHtml(doc())));

  h.use('/api/v1/*', principalMiddleware(app));
  // Anonymous reads are limited per replica; signed-in users and API tokens are not.
  h.use(
    '/api/v1/*',
    rateLimit(app, 'public', {
      shared: false,
      // Pushes have their own limit.
      skip: (c) => c.get('principal') !== null || c.req.path.startsWith('/api/v1/push/'),
    }),
  );
  // Before the public routes: the push secret is the credential, also on private sites.
  h.route('/api/v1', pushRoutes(app));
  h.route('/api/v1', bootstrapRoutes(app));
  h.route('/api/v1/admin', adminRoutes(app));
  h.route('/api/v1', publicRoutes(app));
  h.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  const dist = app.env.webDist;
  if (dist && existsSync(join(dist, 'index.html'))) {
    const root = relative(process.cwd(), dist) || '.';
    h.use('/assets/*', async (c, next) => {
      c.header('cache-control', 'public, max-age=31536000, immutable');
      await next();
    });
    h.use('*', serveStatic({ root }));
    let indexHtml: string | null = null;
    h.get('*', async (c) => {
      indexHtml ??= await readFile(join(dist, 'index.html'), 'utf8');
      c.header('cache-control', 'no-cache');
      return c.html(indexHtml);
    });
  } else {
    h.get('/', (c) =>
      c.text('heartline API is running. Build apps/web (pnpm build) to serve the UI from here.'),
    );
  }
  return h;
}
