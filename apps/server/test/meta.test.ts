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

const TEMPLATE =
  '<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="/favicon.svg" /><title>Status</title><!--app-head--></head><body><div id="root"></div></body></html>';

async function withWeb(config: string) {
  const dist = await mkdtemp(join(tmpdir(), 'heartline-meta-'));
  await writeFile(join(dist, 'index.html'), TEMPLATE);
  h = await harness(config, { env: { webDist: dist } });
}

const html = async (path: string) => (await h!.request(path)).text();

describe('page meta', () => {
  it('describes each page for link previews, escaped', async () => {
    await withWeb(
      BASE_CONFIG.replace(
        'site: { title: Test status, timezone: UTC }',
        "site: { title: Test status, timezone: UTC, faviconUrl: 'https://cdn.example.com/icon.png', ogImage: 'https://cdn.example.com/og.png' }",
      ),
    );
    const home = await html('/');
    expect(home).toContain('<title>Test status</title>');
    expect(home).toContain('<meta property="og:title" content="Test status" />');
    expect(home).toContain('<meta property="og:image" content="https://cdn.example.com/og.png" />');
    expect(home).toContain('<link rel="icon" href="https://cdn.example.com/icon.png" />');
    expect(home).toContain('<link rel="canonical" href="http://localhost:3999" />');
    expect(home).not.toContain('noindex');

    const cookie = await h!.login();
    const i = await (
      await h!.request('/api/v1/admin/incidents', {
        method: 'POST',
        cookie,
        json: { title: '<script>alert(1)</script> outage', message: 'We are **on it**.', notify: false },
      })
    ).json();
    const page = await html(`/incidents/${i.id}`);
    expect(page).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; outage · Test status</title>');
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('content="Ongoing. We are on it."');
    expect(await html('/services/web')).toContain('<title>Website · Test status</title>');
    expect(await html('/admin/monitors')).toContain('<meta name="robots" content="noindex" />');
  });

  it('tells nothing about a private site', async () => {
    await withWeb(BASE_CONFIG.replace('timezone: UTC }', 'timezone: UTC, public: false }'));
    const page = await html('/services/web');
    expect(page).toContain('<title>Test status</title>');
    expect(page).not.toContain('Website');
    expect(page).toContain('noindex');
  });
});
