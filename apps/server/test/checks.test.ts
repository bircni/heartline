import { once } from 'node:events';
import { type Server, createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { monitorSpecSchema } from '@heartline/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/checks/index.ts';
import { PluginRegistry } from '../src/checks/plugins.ts';

const plugins = new PluginRegistry(fileURLToPath(new URL('./fixtures/plugins', import.meta.url)));
let http: Server;
let base: string;

beforeAll(async () => {
  await plugins.load();
  http = createServer((req, res) => {
    if (req.url === '/ok') return res.end('{"status":"pass"}');
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 300);
    if (req.url === '/hang') return;
    res.statusCode = 503;
    res.end('down');
  }).listen(0, '127.0.0.1');
  await once(http, 'listening');
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => http.close());

const spec = (input: Record<string, unknown>) => monitorSpecSchema.parse({ id: 't', name: 'T', ...input });

describe('http checks', () => {
  it('passes on matching JSON and fails on bad status', async () => {
    expect(
      (
        await runCheck(
          spec({ type: 'http', url: `${base}/ok`, expect: { json: { status: 'pass' } } }),
          plugins,
        )
      ).status,
    ).toBe('up');
    const bad = await runCheck(spec({ type: 'http', url: `${base}/nope` }), plugins);
    expect(bad).toMatchObject({ status: 'down', message: 'HTTP 503' });
  });
  it('marks slow responses degraded and enforces timeouts', async () => {
    expect(
      (await runCheck(spec({ type: 'http', url: `${base}/slow`, degradedAfter: '100ms' }), plugins)).status,
    ).toBe('degraded');
    const hung = await runCheck(spec({ type: 'http', url: `${base}/hang`, timeout: '200ms' }), plugins);
    expect(hung).toMatchObject({ status: 'down', message: 'timed out' });
  });
  it('reports connection errors with their code', async () => {
    const srv = createTcpServer().listen(0, '127.0.0.1');
    await once(srv, 'listening');
    const port = (srv.address() as AddressInfo).port;
    srv.close();
    await once(srv, 'close');
    const res = await runCheck(spec({ type: 'http', url: `http://127.0.0.1:${port}/` }), plugins);
    expect(res.status).toBe('down');
    expect(res.message).toMatch(/ECONNREFUSED/);
  });
});

describe('tcp checks', () => {
  it('connects to open ports and fails on closed ones', async () => {
    const srv = createTcpServer((s) => s.end()).listen(0, '127.0.0.1');
    await once(srv, 'listening');
    const port = (srv.address() as AddressInfo).port;
    expect((await runCheck(spec({ type: 'tcp', host: '127.0.0.1', port }), plugins)).status).toBe('up');
    srv.close();
    await once(srv, 'close');
    expect((await runCheck(spec({ type: 'tcp', host: '127.0.0.1', port }), plugins)).status).toBe('down');
  });
});

describe('plugins', () => {
  it('lists installed plugins with their args', () => {
    expect(
      plugins
        .list()
        .map((p) => p.name)
        .toSorted(),
    ).toEqual(['echo-json', 'env-dump', 'exit-code', 'slow']);
  });
  it('maps exit codes', async () => {
    expect(
      (await runCheck(spec({ type: 'plugin', plugin: 'exit-code', args: { code: 0 } }), plugins)).status,
    ).toBe('up');
    expect(
      await runCheck(spec({ type: 'plugin', plugin: 'exit-code', args: { code: 2 } }), plugins),
    ).toMatchObject({ status: 'degraded', message: 'code 2' });
    expect(
      (await runCheck(spec({ type: 'plugin', plugin: 'exit-code', args: { code: 1 } }), plugins)).status,
    ).toBe('down');
  });
  it('reads the JSON result line', async () => {
    const res = await runCheck(
      spec({ type: 'plugin', plugin: 'echo-json', args: { status: 'degraded' } }),
      plugins,
    );
    expect(res).toEqual({ status: 'degraded', latencyMs: 42, message: 'from json' });
  });
  it('kills plugins that exceed their timeout', async () => {
    const started = Date.now();
    const res = await runCheck(spec({ type: 'plugin', plugin: 'slow' }), plugins);
    expect(res.status).toBe('down');
    expect(res.message).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
  it('validates args and missing plugins', async () => {
    expect(
      (await runCheck(spec({ type: 'plugin', plugin: 'echo-json', args: {} }), plugins)).message,
    ).toMatch(/missing required arg "status"/);
    expect(
      (await runCheck(spec({ type: 'plugin', plugin: 'exit-code', args: { nope: 1 } }), plugins)).message,
    ).toMatch(/unknown args nope/);
    expect((await runCheck(spec({ type: 'plugin', plugin: 'ghost' }), plugins)).message).toMatch(
      /not installed/,
    );
  });
  it('does not leak server environment variables to plugins', async () => {
    process.env.SUPER_SECRET = 'x';
    const res = await runCheck(spec({ type: 'plugin', plugin: 'env-dump' }), plugins);
    expect(res.message?.split(',')).not.toContain('SUPER_SECRET');
    expect(res.message?.split(',')).toContain('STATUS_MONITOR_ID');
  });
});
