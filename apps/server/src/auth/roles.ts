import type { Role, Scope } from '@heartline/shared';
import type { OidcProviderConfig } from '../config/schema.ts';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };
const SCOPE_RANK: Record<Scope, number> = { read: 1, write: 2, admin: 3 };

export const OAUTH_SCOPES = ['status:read', 'status:write', 'status:admin'] as const;

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'editor' || value === 'viewer';
}

export function roleAtLeast(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

/** Highest scope a role may hold. */
export function maxScopeFor(role: Role): Scope {
  return role === 'admin' ? 'admin' : role === 'editor' ? 'write' : 'read';
}

/** Effective permission: the lower of the user's role and the token's highest scope. */
export function effectiveScope(role: Role, scopes: Scope[]): Scope | null {
  const roleMax = SCOPE_RANK[maxScopeFor(role)];
  const tokenMax = Math.max(0, ...scopes.map((s) => SCOPE_RANK[s]));
  const level = Math.min(roleMax, tokenMax);
  return level === 3 ? 'admin' : level === 2 ? 'write' : level === 1 ? 'read' : null;
}

export function scopeAtLeast(scope: Scope | null, needed: Scope): boolean {
  return scope !== null && SCOPE_RANK[scope] >= SCOPE_RANK[needed];
}

export function oauthScopesToScopes(granted: string[]): Scope[] {
  return granted
    .filter((s) => s.startsWith('status:'))
    .map((s) => s.slice('status:'.length))
    .filter((s): s is Scope => s === 'read' || s === 'write' || s === 'admin');
}

/** Maps OIDC group claims to the highest configured role, or the provider's default. */
export function roleFromGroups(provider: OidcProviderConfig, groups: unknown): Role | 'none' {
  const list = Array.isArray(groups)
    ? groups.map(String)
    : typeof groups === 'string'
      ? groups.split(/[ ,]+/)
      : [];
  let best: Role | null = null;
  for (const g of list) {
    const r = provider.roles[g];
    if (r && (!best || RANK[r] > RANK[best])) best = r;
  }
  return best ?? provider.defaultRole;
}
