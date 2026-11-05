import { resolve } from 'node:path';

export interface Env {
  port: number;
  host: string;
  databaseUrl: string;
  configPath: string;
  pluginsDir: string;
  webDist: string | null;
  baseUrl: string;
  /** How this process reaches itself (JWKS for MCP token checks), independent of ingress/DNS. */
  internalUrl: string;
  authSecret: string;
  isProduction: boolean;
  /** NVD API key for vulnerability lookups (optional, raises the rate limit). */
  nvdApiKey: string | null;
  /** HEARTLINE_OFFLINE=1: never contact vulnerability or release data sources. */
  offline: boolean;
  /** GitHub token for release lookups (optional, raises the API rate limit). */
  githubToken: string | null;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const isProduction = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 3000);
  const secret = env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET;
  if (!secret && isProduction)
    throw new Error('AUTH_SECRET must be set in production (32+ random characters)');
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? 'sqlite:./data/status.db',
    configPath: resolve(env.CONFIG_PATH ?? 'status.yaml'),
    pluginsDir: resolve(env.PLUGINS_DIR ?? 'plugins'),
    webDist: env.WEB_DIST === '' ? null : resolve(env.WEB_DIST ?? '../web/dist'),
    baseUrl: (env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    internalUrl: `http://127.0.0.1:${port}`,
    authSecret: secret ?? 'dev-only-insecure-secret-change-me-0123456789',
    isProduction,
    nvdApiKey: env.NVD_API_KEY?.trim() || null,
    offline: ['1', 'true', 'yes'].includes((env.HEARTLINE_OFFLINE ?? '').toLowerCase()),
    githubToken: env.GITHUB_TOKEN?.trim() || null,
  };
}
