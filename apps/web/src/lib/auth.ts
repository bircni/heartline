import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  // Forwards the signed OAuth query from /login and /consent so MCP clients resume their authorization.
  plugins: [oauthProviderClient()],
});

const OAUTH_SIGNATURE_PARAMS = ['sig', 'exp', 'ba_iat', 'ba_pl'];

/** True when /login or /consent was opened by the OAuth provider for an MCP client. */
export function isOAuthContinuation(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has('client_id') && q.has('sig');
}

/** The original authorization request, used to resume after an external (Gitea) sign-in. */
export function authorizeUrlFrom(search: string): string {
  const q = new URLSearchParams(search);
  for (const p of OAUTH_SIGNATURE_PARAMS) q.delete(p);
  return `/api/auth/oauth2/authorize?${q.toString()}`;
}
