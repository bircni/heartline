import type { Role, Scope } from '@heartline/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppContext } from '../context.ts';
import { effectiveScope, isRole, maxScopeFor, scopeAtLeast } from './roles.ts';

export interface Principal {
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** Effective permission for this request (role capped by token scopes). */
  scope: Scope;
  via: 'session' | 'token' | 'oauth';
}

export type Vars = { Variables: { principal: Principal | null } };

export async function principalForUser(
  app: AppContext,
  userId: string,
  scopes: Scope[] | null,
  via: Principal['via'],
): Promise<Principal | null> {
  const user = await app.db.kysely
    .selectFrom('user')
    .select(['id', 'name', 'email', 'role'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || !isRole(user.role)) return null;
  const scope = scopes ? effectiveScope(user.role, scopes) : maxScopeFor(user.role);
  if (!scope) return null;
  return { userId: user.id, name: user.name, email: user.email, role: user.role, scope, via };
}

export async function resolvePrincipal(app: AppContext, headers: Headers): Promise<Principal | null> {
  const authz = headers.get('authorization');
  if (authz?.startsWith('Bearer hl_')) {
    const owner = await app.tokens.verify(authz.slice('Bearer '.length).trim());
    return owner ? principalForUser(app, owner.userId, owner.scopes, 'token') : null;
  }
  const session = await app.auth.api.getSession({ headers }).catch(() => null);
  return session ? principalForUser(app, session.user.id, null, 'session') : null;
}

export function principalMiddleware(app: AppContext): MiddlewareHandler<Vars> {
  return async (c, next) => {
    c.set('principal', await resolvePrincipal(app, c.req.raw.headers));
    await next();
  };
}

export function requireScope(needed: Scope): MiddlewareHandler<Vars> {
  return async (c, next) => {
    const p = c.get('principal');
    if (!p) return c.json({ error: 'Sign in or provide an API token.' }, 401);
    if (!scopeAtLeast(p.scope, needed))
      return c.json({ error: `This action needs the "${needed}" permission.` }, 403);
    await next();
  };
}

export function principalOf(c: Context<Vars>): Principal {
  const p = c.get('principal');
  if (!p) throw new Error('principal missing; route is not protected');
  return p;
}
