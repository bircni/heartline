import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_CONFIG, type Harness, harness } from './helpers.ts';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

async function withWeb(config = BASE_CONFIG) {
  const dist = await mkdtemp(join(tmpdir(), 'heartline-web-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Status</title><div id="root"></div>');
  await writeFile(join(dist, 'widget.js'), 'console.log(1)');
  h = await harness(config, { env: { webDist: dist } });
}

const csp = (res: Response) => res.headers.get('content-security-policy') ?? '';

describe('embedding', () => {
  it('lets other sites frame /embed only, and load badges, the widget and read APIs', async () => {
    await withWeb(`${BASE_CONFIG}embed: { frameAncestors: ['https://intranet.example.com'] }\n`);
    const page = await h!.request('/');
    expect(csp(page)).toContain("frame-ancestors 'none'");
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(page.headers.get('cross-origin-resource-policy')).toBe('same-origin');

    const embed = await h!.request('/embed');
    expect(embed.status).toBe(200);
    expect(csp(embed)).toContain('frame-ancestors https://intranet.example.com');
    expect(embed.headers.get('x-frame-options')).toBeNull();

    for (const path of ['/api/v1/badge/web.svg', '/api/v2/summary.json', '/api/v1/overview', '/widget.js']) {
      const res = await h!.request(path, { headers: { origin: 'https://blog.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
    expect((await h!.request('/widget.js')).headers.get('cache-control')).toBe('public, max-age=300');

    // Never for admin, sign-in or MCP.
    const cookie = await h!.login();
    for (const path of ['/api/v1/admin/monitors', '/api/v1/me']) {
      const res = await h!.request(path, { cookie, headers: { origin: 'https://evil.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('can be switched off', async () => {
    await withWeb(`${BASE_CONFIG}embed: { enabled: false }\n`);
    expect(csp(await h!.request('/embed'))).toContain("frame-ancestors 'none'");
    const badge = await h!.request('/api/v1/badge/web.svg', {
      headers: { origin: 'https://blog.example.com' },
    });
    expect(badge.headers.get('access-control-allow-origin')).toBeNull();
  });
});
