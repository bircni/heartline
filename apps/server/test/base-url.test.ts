import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN, BASE, BASE_CONFIG, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const TEMPLATE =
  '<!doctype html><html><head><base href="/" /><link rel="icon" href="favicon.svg" /><title>Status</title><!--app-head--></head><body><div id="root"></div><script type="module" src="./assets/main.js"></script></body></html>';

async function webDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'heartline-base-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), TEMPLATE);
  await writeFile(join(dist, 'assets', 'main.js'), 'console.log(1);');
  await writeFile(join(dist, 'widget.js'), 'console.log(2);');
  return dist;
}

describe('BASE_URL with a sub-path', () => {
  const PREFIX = '/heartline';
  const SITE = `${BASE}${PREFIX}`;

  it('serves the app, assets and API under the sub-path, whether or not the proxy strips it', async () => {
    h = await harness(BASE_CONFIG, { env: { baseUrl: SITE, webDist: await webDist() } });
    // `handle_path` (Caddy) strips the prefix; a plain `reverse_proxy` or nginx without a trailing slash keeps it.
    for (const p of [PREFIX, '']) {
      expect((await h.request(`${p}/assets/main.js`)).status, `${p}/assets/main.js`).toBe(200);
      expect((await h.request(`${p}/widget.js`)).status).toBe(200);
      const site = await h.request(`${p}/api/v1/site`);
      expect(site.status).toBe(200);
      expect((await site.json()).site.title).toBe('Test status');
      const deep = await h.request(`${p}/services/web`);
      expect(deep.status).toBe(200);
      const html = await deep.text();
      expect(html).toContain(`<base href="${PREFIX}/" />`);
      expect(html).toContain(`<link rel="canonical" href="${SITE}/services/web" />`);
      expect((await h.request(`${p}/api/auth/get-session`)).status).toBe(200);
    }
    expect(await h.request(`${PREFIX}/`).then((r) => r.text())).toContain(`<base href="${PREFIX}/" />`);
    expect((await h.request(`${PREFIX}/api/v1/nope`)).status).toBe(404);
  });

  it('signs in and keeps the session under the sub-path', async () => {
    h = await harness(BASE_CONFIG, { env: { baseUrl: SITE } });
    const res = await h.request(`${PREFIX}/api/auth/sign-in/email`, { method: 'POST', json: ADMIN });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const me = await h.request(`${PREFIX}/api/v1/me`, { cookie });
    expect((await me.json()).email).toBe(ADMIN.email);
  });

  it('advertises the MCP resource and sends OAuth sign-ins to the prefixed login page', async () => {
    h = await harness(BASE_CONFIG, { env: { baseUrl: SITE } });
    const challenge = await h.request(`${PREFIX}/mcp`, {
      method: 'POST',
      json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('www-authenticate')).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource${PREFIX}/mcp"`,
    );
    const meta = await (await h.request(`/.well-known/oauth-protected-resource${PREFIX}/mcp`)).json();
    expect(meta.resource).toBe(`${SITE}/mcp`);
    expect(meta.authorization_servers).toEqual([`${SITE}/api/auth`]);

    const asMeta = await (
      await h.request(`/.well-known/oauth-authorization-server${PREFIX}/api/auth`)
    ).json();
    expect(asMeta.issuer).toBe(`${SITE}/api/auth`);
    const redirectUri = 'http://127.0.0.1:43210/callback';
    const reg = await h.request(new URL(asMeta.registration_endpoint).pathname, {
      method: 'POST',
      json: {
        client_name: 'test client',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'openid status:read',
      },
    });
    expect(reg.status).toBe(201);
    const { client_id } = await reg.json();
    const authorize = new URL(asMeta.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: 'code',
      client_id,
      redirect_uri: redirectUri,
      scope: 'openid status:read',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      resource: `${SITE}/mcp`,
      state: 'x',
    }))
      authorize.searchParams.set(k, v);
    const res = await h.request(`${authorize.pathname}${authorize.search}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(new RegExp(`^${PREFIX}/login\\?`));
  });
});
