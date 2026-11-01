import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, BASE, harness } from './helpers.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

async function rpc(token: string, method: string, params: unknown = {}, id = 1) {
  const res = await h.request('/mcp', {
    method: 'POST',
    token,
    headers: { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    json: { jsonrpc: '2.0', id, method, params },
  });
  const text = await res.text();
  const data = text.startsWith('event:')
    ? text
        .split('\n')
        .find((l) => l.startsWith('data: '))
        ?.slice(6)
    : text;
  return { status: res.status, body: data ? JSON.parse(data) : null };
}

describe('MCP with API tokens', () => {
  it('lists tools and enforces scopes per tool', async () => {
    const cookie = await h.login();
    const { token } = await (
      await h.request('/api/v1/admin/tokens', {
        method: 'POST',
        cookie,
        json: { name: 'mcp', scopes: ['write'] },
      })
    ).json();
    const init = await rpc(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.body.result.serverInfo.name).toBe('heartline');
    const tools = await rpc(token, 'tools/list');
    const names = tools.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_services',
        'get_service',
        'uptime_report',
        'create_incident',
        'schedule_maintenance',
        'create_monitor',
        'test_plugin',
      ]),
    );

    const created = await rpc(token, 'tools/call', {
      name: 'create_incident',
      arguments: { title: 'From MCP', message: 'Investigating', services: ['web'] },
    });
    expect(created.body.result.isError).toBeUndefined();
    expect(created.body.result.structuredContent.title).toBe('From MCP');

    const denied = await rpc(token, 'tools/call', {
      name: 'create_monitor',
      arguments: { group: 'X', spec: { id: 'x', name: 'X', type: 'icmp', host: 'h' } },
    });
    expect(denied.body.result.isError).toBe(true);
    expect(denied.body.result.content[0].text).toMatch(/needs "admin"/);

    const report = await rpc(token, 'tools/call', { name: 'uptime_report', arguments: { days: 7 } });
    expect(report.body.result.content[0].text).toMatch(/Uptime over the last 7 days/);

    const summary = await rpc(token, 'resources/read', { uri: 'status://summary' });
    expect(JSON.parse(summary.body.result.contents[0].text).services).toHaveLength(2);
  });

  it('challenges unauthenticated requests with protected resource metadata', async () => {
    const res = await h.request('/mcp', {
      method: 'POST',
      json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
    );
    const meta = await (await h.request('/.well-known/oauth-protected-resource/mcp')).json();
    expect(meta.resource).toBe(`${BASE}/mcp`);
    expect(meta.scopes_supported).toContain('status:read');
  });
});

describe('MCP with OAuth', () => {
  it('runs the authorization code flow with dynamic registration and PKCE', async () => {
    const asMeta = await (await h.request('/.well-known/oauth-authorization-server/api/auth')).json();
    expect(asMeta.registration_endpoint).toBeTruthy();
    const redirectUri = 'http://127.0.0.1:43210/callback';
    const reg = await h.request(new URL(asMeta.registration_endpoint).pathname, {
      method: 'POST',
      json: {
        client_name: 'test client',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid offline_access status:read status:write',
      },
    });
    const client = await reg.json();
    expect(client.client_id).toBeTruthy();
    expect(reg.status).toBe(201);

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorize = new URL(asMeta.authorization_endpoint);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: 'openid status:read status:write',
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${BASE}/mcp`,
    }).toString();

    // Not signed in: the provider redirects to our login page with a signed query.
    const first = await h.request(authorize.pathname + authorize.search);
    expect(first.status).toBe(302);
    const loginUrl = new URL(first.headers.get('location') as string, BASE);
    expect(loginUrl.pathname).toBe('/login');

    // The login page signs in and forwards the signed query, then follows the redirects.
    const signIn = await h.request('/api/auth/sign-in/email', {
      method: 'POST',
      json: {
        email: 'admin@test.local',
        password: 'correct-horse-battery',
        oauth_query: loginUrl.search.slice(1),
      },
    });
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    let next = (await signIn.json()).url as string | undefined;
    expect(next).toBeTruthy();

    let callback: URL | null = null;
    for (let i = 0; i < 5 && next && !callback; i++) {
      const u = new URL(next, BASE);
      if (u.origin + u.pathname === redirectUri) {
        callback = u;
        break;
      }
      if (u.pathname === '/consent') {
        const consent = await h.request('/api/auth/oauth2/consent', {
          method: 'POST',
          cookie,
          json: { accept: true, oauth_query: u.search.slice(1) },
        });
        next = (await consent.json()).url;
        continue;
      }
      const res = await h.request(u.pathname + u.search, { cookie });
      next = res.headers.get('location') ?? undefined;
    }
    expect(callback?.searchParams.get('state')).toBe('xyz');
    const code = callback?.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await h.request(new URL(asMeta.token_endpoint).pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: `${BASE}/mcp`,
      }).toString(),
    });
    const tokens = await tokenRes.json();
    expect(tokens.error).toBeUndefined();
    expect(tokenRes.status).toBe(200);
    expect(tokens.access_token).toBeTruthy();

    const tools = await rpc(tokens.access_token, 'tools/call', { name: 'list_services', arguments: {} });
    expect(tools.status).toBe(200);
    expect(tools.body.result.content[0].text).toMatch(/Website \[web\]/);
    const write = await rpc(tokens.access_token, 'tools/call', {
      name: 'create_incident',
      arguments: { title: 'OAuth', message: 'm' },
    });
    expect(write.body.result.isError).toBeUndefined();
    const admin = await rpc(tokens.access_token, 'tools/call', {
      name: 'test_plugin',
      arguments: { plugin: 'exit-code' },
    });
    expect(admin.body.result.isError).toBe(true);
  });
});
