import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { bootstrap } from './bootstrap.ts';
import { ConfigError, loadConfig } from './config/load.ts';
import { readEnv } from './env.ts';
import { log } from './util/log.ts';
import { installProxyDispatcher } from './util/proxy.ts';

async function main() {
  if (installProxyDispatcher()) log.info('using HTTP(S)_PROXY for outbound requests');
  const env = readEnv();
  if (!env.isProduction && !process.env.AUTH_SECRET)
    log.warn('AUTH_SECRET is not set; using an insecure development secret');
  const config = await loadConfig(env.configPath);
  // site.baseUrl in status.yaml wins over BASE_URL (links, OAuth redirects, the MCP resource).
  if (config.site.baseUrl) env.baseUrl = config.site.baseUrl.replace(/\/$/, '');
  const runtime = await bootstrap({
    env,
    config,
    devOrigins: env.isProduction ? [] : ['http://localhost:5173'],
  });
  const app = createApp(runtime);
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
    log.info('heartline listening', {
      url: env.baseUrl,
      port: info.port,
      database: runtime.db.kind,
      services: runtime.monitors.list().length,
    });
  });
  await runtime.start();

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    server.close();
    await runtime.stop();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  if (error instanceof ConfigError) log.error(error.message);
  else
    log.error('failed to start', {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  process.exit(1);
});
