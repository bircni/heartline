import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN, BASE_CONFIG, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe('plain HTTP BASE_URL', () => {
  const LAN = 'http://status.lan:3000';

  it('starts with MCP off, and local sign-in still works', async () => {
    h = await harness(BASE_CONFIG, { env: { baseUrl: LAN } });
    expect((await h.request('/api/v1/site').then((r) => r.json())).mcp).toBe(false);

    const mcp = await h.request('/mcp', {
      method: 'POST',
      json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status).toBe(404);
    expect((await h.request('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
    expect((await h.request('/.well-known/oauth-authorization-server/api/auth')).status).toBe(404);

    const signIn = await h.app.request(`${LAN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: LAN, 'content-type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    expect(signIn.status).toBe(200);
  });

  it('can be turned off on HTTPS with MCP_ENABLED=false', async () => {
    h = await harness(BASE_CONFIG, { env: { mcpEnabled: false } });
    expect((await h.request('/api/v1/site').then((r) => r.json())).mcp).toBe(false);
    expect((await h.request('/mcp', { method: 'POST', json: {} })).status).toBe(404);
  });

  it('keeps MCP on for a loopback URL', async () => {
    h = await harness();
    expect((await h.request('/api/v1/site').then((r) => r.json())).mcp).toBe(true);
  });
});
