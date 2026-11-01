import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { genericOAuth, jwt } from 'better-auth/plugins';
import type { AppConfig } from '../config/schema.ts';
import type { Db } from '../db/index.ts';
import type { Env } from '../env.ts';
import { log } from '../util/log.ts';
import { OAUTH_SCOPES, isRole, roleFromGroups } from './roles.ts';

export function mcpResource(baseUrl: string): string {
  return `${baseUrl}/mcp`;
}

/**
 * Roles mapped from OIDC groups, waiting for the user row to be created. `role` is not an input
 * field (users must not set it themselves), so better-auth drops it from the mapped profile.
 */
const pendingRoles = new Map<string, { role: string; at: number }>();

function takePendingRole(email: string): string | undefined {
  const now = Date.now();
  for (const [k, v] of pendingRoles) if (now - v.at > 10 * 60_000) pendingRoles.delete(k);
  const hit = pendingRoles.get(email.toLowerCase());
  pendingRoles.delete(email.toLowerCase());
  return hit?.role;
}

export function authOptions(
  env: Env,
  config: AppConfig,
  db: Db,
  extraOrigins: string[] = [],
  liveConfig: () => AppConfig = () => config,
) {
  return {
    appName: config.site.title,
    baseURL: env.baseUrl,
    basePath: '/api/auth',
    secret: env.authSecret,
    database: { db: db.kysely, type: db.kind },
    trustedOrigins: [env.baseUrl, ...extraOrigins],
    emailAndPassword: { enabled: config.auth.local, disableSignUp: true, minPasswordLength: 12 },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'viewer', input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: { cookiePrefix: 'heartline', useSecureCookies: env.baseUrl.startsWith('https://') },
    telemetry: { enabled: false },
    logger: {
      log: (level: 'debug' | 'info' | 'warn' | 'error' | 'success', message: string, ...args: unknown[]) => {
        // SQLite stores better-auth's string[] columns as JSON text by design; the type-drift warning is noise.
        if (message.includes('has a different type in the database')) return;
        const fields = args.length
          ? { details: args.map((a) => (a instanceof Error ? a.message : a)) }
          : undefined;
        if (level === 'error') log.error(`auth: ${message}`, fields);
        else if (level === 'warn') log.warn(`auth: ${message}`, fields);
        else log.debug(`auth: ${message}`, fields);
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const role = typeof user.email === 'string' ? takePendingRole(user.email) : undefined;
            return { data: role ? { ...user, role } : user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await db.kysely
              .selectFrom('user')
              .select('role')
              .where('id', '=', session.userId)
              .executeTakeFirst();
            if (!user || !isRole(user.role))
              throw new APIError('FORBIDDEN', { message: 'Your account has no access to this status page.' });
            return { data: session };
          },
        },
      },
    },
    plugins: [
      jwt(),
      mcp({
        loginPage: '/login',
        consentPage: '/consent',
        resource: mcpResource(env.baseUrl),
        scopes: ['openid', 'profile', 'email', 'offline_access', ...OAUTH_SCOPES],
        clientRegistrationDefaultScopes: ['openid', 'profile', 'offline_access', 'status:read'],
        clientRegistrationAllowedScopes: ['openid', 'profile', 'email', 'offline_access', ...OAUTH_SCOPES],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // CLI clients such as Claude Code register loopback redirect URIs and are native apps.
        clientRegistrationDefaultApplicationType: 'infer',
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      ...(config.auth.oidc.length
        ? [
            genericOAuth({
              config: config.auth.oidc.map((p) => ({
                providerId: p.id,
                name: p.name,
                discoveryUrl: p.discoveryUrl,
                clientId: p.clientId,
                clientSecret: p.clientSecret,
                scopes: p.scopes,
                pkce: true,
                mapProfileToUser: async (profile: Record<string, unknown>) => {
                  // Role mappings follow status.yaml reloads; adding or removing providers needs a restart.
                  const live = liveConfig().auth.oidc.find((x) => x.id === p.id) ?? p;
                  const role = roleFromGroups(live, profile[live.groupsClaim]);
                  if (role === 'none')
                    throw new APIError('FORBIDDEN', {
                      message: `Your ${p.name} account is not allowed to sign in here.`,
                    });
                  const email = typeof profile.email === 'string' ? profile.email : null;
                  if (email) {
                    // First sign-in: applied when the user row is created. Later sign-ins: keep the
                    // role in sync with group membership.
                    pendingRoles.set(email.toLowerCase(), { role, at: Date.now() });
                    await db.kysely
                      .updateTable('user')
                      .set({ role })
                      .where('email', '=', email.toLowerCase())
                      .execute();
                  }
                  return { role };
                },
              })),
            }),
          ]
        : []),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(
  env: Env,
  config: AppConfig,
  db: Db,
  extraOrigins: string[] = [],
  liveConfig?: () => AppConfig,
) {
  return betterAuth(authOptions(env, config, db, extraOrigins, liveConfig));
}

export type Auth = ReturnType<typeof createAuth>;

export async function migrateAuth(env: Env, config: AppConfig, db: Db): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(env, config, db));
  await runMigrations();
}

/** Creates or updates the users listed in status.yaml (role and password follow the config). */
export async function seedUsers(auth: Auth, config: AppConfig, db: Db): Promise<void> {
  const ctx = await auth.$context;
  for (const u of config.auth.users) {
    const email = u.email.toLowerCase();
    const existing = await db.kysely
      .selectFrom('user')
      .select(['id', 'role'])
      .where('email', '=', email)
      .executeTakeFirst();
    if (!existing) {
      const user = await ctx.internalAdapter.createUser(
        { email, name: u.name, emailVerified: true, role: u.role },
        { method: 'admin' },
      );
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await ctx.password.hash(u.password),
      });
      log.info('seeded user from status.yaml', { email, role: u.role });
      continue;
    }
    if (existing.role !== u.role)
      await db.kysely.updateTable('user').set({ role: u.role }).where('id', '=', existing.id).execute();
    const accounts = await ctx.internalAdapter.findAccounts(existing.id);
    const credential = accounts.find((a) => a.providerId === 'credential');
    if (!credential) {
      await ctx.internalAdapter.linkAccount({
        userId: existing.id,
        providerId: 'credential',
        accountId: existing.id,
        password: await ctx.password.hash(u.password),
      });
    } else if (
      !credential.password ||
      !(await ctx.password.verify({ hash: credential.password, password: u.password }))
    ) {
      await ctx.internalAdapter.updatePassword(existing.id, await ctx.password.hash(u.password));
      log.info('updated seeded user password from status.yaml', { email });
    }
  }
}
