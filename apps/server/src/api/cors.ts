import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppContext } from '../context.ts';

const CSP = {
  defaultSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  styleSrc: ["'self'", "'unsafe-inline'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'"],
  formAction: ["'self'", 'https:', 'http:'],
};

/**
 * Read-only data other sites may load: the v2 status API, the status and incident reads the widget and
 * embed use, badges, and the widget script. Never admin, auth or MCP routes.
 */
export function isEmbeddableRead(path: string): boolean {
  return (
    path.startsWith('/api/v2/') ||
    path === '/widget.js' ||
    path.startsWith('/api/v1/badge/') ||
    path === '/api/v1/site' ||
    path === '/api/v1/overview' ||
    path === '/api/v1/incidents' ||
    /^\/api\/v1\/incidents\/[^/]+$/.test(path) ||
    path === '/api/v1/incidents.atom' ||
    path === '/api/v1/incidents.rss' ||
    path === '/api/v1/maintenance' ||
    /^\/api\/v1\/maintenance\/[^/]+$/.test(path) ||
    /^\/api\/v1\/services\/[^/]+$/.test(path)
  );
}

/**
 * Security headers per request. Pages may not be framed, except `/embed` by the origins in
 * `embed.frameAncestors`. Embeddable reads say `Cross-Origin-Resource-Policy: cross-origin`, so a badge or the
 * widget script loads on other sites (browsers block same-origin resources there).
 */
export function securityHeaders(app: AppContext): MiddlewareHandler {
  const base = secureHeaders({
    contentSecurityPolicy: { ...CSP, frameAncestors: ["'none'"] },
    crossOriginEmbedderPolicy: false,
  });
  const shared = secureHeaders({
    contentSecurityPolicy: { ...CSP, frameAncestors: ["'none'"] },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: 'cross-origin',
  });
  let embed: { key: string; mw: MiddlewareHandler } | null = null;
  const embedHeaders = (): MiddlewareHandler => {
    const cfg = app.config().embed;
    const ancestors = cfg.enabled ? cfg.frameAncestors : ["'none'"];
    const key = JSON.stringify(ancestors);
    if (embed?.key !== key)
      embed = {
        key,
        mw: secureHeaders({
          contentSecurityPolicy: { ...CSP, frameAncestors: ancestors },
          crossOriginEmbedderPolicy: false,
          // frame-ancestors decides; X-Frame-Options cannot list origins.
          xFrameOptions: false,
        }),
      };
    return embed.mw;
  };
  return (c, next) => {
    if (c.req.path === '/embed') return embedHeaders()(c, next);
    if (app.config().embed.enabled && isEmbeddableRead(c.req.path)) return shared(c, next);
    return base(c, next);
  };
}

/** CORS for the embeddable reads: any origin, read-only, never with cookies. */
export function embedCors(app: AppContext): MiddlewareHandler {
  const handler = cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'OPTIONS'], maxAge: 86_400 });
  return (c, next) =>
    app.config().embed.enabled && isEmbeddableRead(c.req.path) ? handler(c, next) : next();
}
