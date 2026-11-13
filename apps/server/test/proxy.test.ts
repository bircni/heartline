import { once } from 'node:events';
import { type Server, createServer, request } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProxyDispatcher, proxyConfigured } from '../src/util/proxy.ts';

let target: Server;
let proxy: Server;
let targetPort: number;
let proxyUrl: string;
/** Hosts the proxy was asked for; every request is sent on to the local target. */
const seen: string[] = [];

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

beforeAll(async () => {
  target = createServer((req, res) => res.end(`target ${req.url}`));
  targetPort = await listen(target);
  proxy = createServer((req, res) => {
    // Forward proxy: absolute-form request URI (plain http targets).
    seen.push(new URL(req.url ?? '').host);
    const upstream = request(
      { host: '127.0.0.1', port: targetPort, path: new URL(req.url ?? '').pathname, method: req.method },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    req.pipe(upstream);
  });
  proxy.on('connect', (req, socket, head) => {
    // CONNECT tunnel (https targets).
    seen.push(req.url ?? '');
    const upstream = connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});
afterAll(() => {
  target.close();
  proxy.close();
});

describe('proxy dispatcher', () => {
  it('is not created without proxy variables', () => {
    expect(proxyConfigured({})).toBe(false);
    expect(createProxyDispatcher({ NO_PROXY: 'example.com' })).toBeUndefined();
    expect(proxyConfigured({ https_proxy: proxyUrl })).toBe(true);
    expect(createProxyDispatcher({ HTTP_PROXY: proxyUrl })).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it('routes requests through the proxy', async () => {
    seen.length = 0;
    const dispatcher = createProxyDispatcher({ HTTP_PROXY: proxyUrl })!;
    const res = await fetch('http://heartline.test/hello', { dispatcher });
    expect(await res.text()).toBe('target /hello');
    expect(seen).toEqual(['heartline.test']);
    await dispatcher.close();
  });

  it('connects loopback targets directly', async () => {
    seen.length = 0;
    const dispatcher = createProxyDispatcher({ HTTP_PROXY: proxyUrl, NO_PROXY: 'example.com' })!;
    for (const host of ['127.0.0.1', 'localhost']) {
      const res = await fetch(`http://${host}:${targetPort}/direct`, { dispatcher });
      expect(await res.text()).toBe('target /direct');
    }
    expect(seen).toEqual([]);
    await dispatcher.close();
  });

  it('honours NO_PROXY', async () => {
    seen.length = 0;
    const dispatcher = createProxyDispatcher({ http_proxy: proxyUrl, no_proxy: 'heartline.test' })!;
    await expect(fetch('http://heartline.test/', { dispatcher })).rejects.toThrow('fetch failed');
    expect(seen).toEqual([]);
    await dispatcher.close();
  });

  it('tunnels https targets for ignoreTls dispatchers', async () => {
    seen.length = 0;
    const dispatcher = createProxyDispatcher({ HTTPS_PROXY: proxyUrl }, { insecure: true })!;
    // The target speaks plain http, so the TLS handshake fails, but only after the CONNECT.
    await expect(fetch('https://heartline.test/', { dispatcher })).rejects.toThrow('fetch failed');
    expect(seen).toEqual(['heartline.test:443']);
    await dispatcher.close();
  });
});
