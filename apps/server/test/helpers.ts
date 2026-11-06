import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type ServerType, serve } from '@hono/node-server';
import { createApp } from '../src/app.ts';
import { type Runtime, bootstrap } from '../src/bootstrap.ts';
import { parseConfig } from '../src/config/load.ts';
import { type Db, openDb } from '../src/db/index.ts';
import type { Env } from '../src/env.ts';

export const BASE = 'http://localhost:3999';
export const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery' };

export const BASE_CONFIG = `
site: { title: Test status, timezone: UTC }
groups:
  - name: Web
    monitors:
      - { id: web, name: Website, type: http, url: "http://127.0.0.1:1/", failureThreshold: 2, notify: [teams], autoIncident: true }
      - { id: api, name: API, type: tcp, host: 127.0.0.1, port: 1 }
notifiers:
  - { id: teams, type: teams, webhookUrl: "https://hooks.example/teams" }
auth:
  users:
    - { email: ${ADMIN.email}, name: Admin, password: ${ADMIN.password}, role: admin }
`;

/** Tests read many JSON bodies; a generic `json()` keeps them free of casts. */
export type TestResponse = Omit<Response, 'json'> & { json<T = any>(): Promise<T> };

export interface Harness {
  runtime: Runtime;
  app: ReturnType<typeof createApp>;
  sent: { url: string; body: unknown }[];
  request: (
    path: string,
    init?: RequestInit & { json?: unknown; cookie?: string; token?: string },
  ) => Promise<TestResponse>;
  login: (email?: string, password?: string) => Promise<string>;
  close: () => Promise<void>;
}

async function freePort(): Promise<number> {
  const srv = createServer().listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const { port } = srv.address() as AddressInfo;
  srv.close();
  await once(srv, 'close');
  return port;
}

export interface HarnessOptions {
  db?: Db;
  env?: Partial<Env>;
  /** Answers outbound requests (intel sources, probes); return undefined to fall through to the notifier stub. */
  fetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response | undefined>;
}

export async function harness(configYaml = BASE_CONFIG, opts: HarnessOptions = {}): Promise<Harness> {
  const port = await freePort();
  const env: Env = {
    port,
    internalUrl: `http://127.0.0.1:${port}`,
    host: '127.0.0.1',
    databaseUrl: 'sqlite::memory:',
    configPath: '/nonexistent/status.yaml',
    pluginsDir: fileURLToPath(new URL('./fixtures/plugins', import.meta.url)),
    webDist: null,
    baseUrl: BASE,
    authSecret: 'test-secret-test-secret-test-secret-1234',
    isProduction: false,
    nvdApiKey: null,
    offline: false,
    githubToken: null,
    ...opts.env,
  };
  const sent: Harness['sent'] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const stubbed = await opts.fetchImpl?.(url, init);
    if (stubbed) return stubbed;
    // Local test servers (version probes) are real; everything else is treated as a notifier call.
    const host = new URL(url instanceof Request ? url.url : String(url)).hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return fetch(url, init);
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  const runtime = await bootstrap({
    env,
    config: parseConfig(configYaml, {}),
    db: opts.db ?? openDb('sqlite::memory:'),
    fetchImpl,
  });
  const app = createApp(runtime);
  // A real listener lets the MCP token check fetch JWKS from this process, like in production.
  const server: ServerType = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  await once(server, 'listening');

  const request: Harness['request'] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', BASE);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    if (init.cookie) headers.set('cookie', init.cookie);
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    return Promise.resolve(
      app.request(`${BASE}${path}`, {
        ...init,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      }),
    ) as Promise<TestResponse>;
  };

  const login = async (email = ADMIN.email, password = ADMIN.password) => {
    const res = await request('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  };

  return {
    runtime,
    app,
    sent,
    request,
    login,
    close: async () => {
      server.close();
      await runtime.stop();
    },
  };
}
