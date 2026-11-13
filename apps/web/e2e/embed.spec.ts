import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Page, expect, test } from '@playwright/test';

/**
 * Opens `html` as a page of another website: a small server on another port, so another origin. It is a real
 * loopback server, so Chrome's local network checks allow it to load the app (they block pages that are not
 * on a local address). A frame-ancestors of '*' only matches http and https origins, so about:blank would
 * not do either.
 */
async function otherSite(page: Page, html: string): Promise<() => Promise<void>> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await page.goto(`http://127.0.0.1:${port}/`);
  return () => new Promise((resolve) => server.close(() => resolve()));
}

test('other pages can frame /embed but not the status page itself', async ({ page, baseURL }) => {
  const close = await otherSite(
    page,
    `<iframe id="embed" src="${baseURL}/embed?theme=light" style="width:480px;height:200px"></iframe>
     <iframe id="page" src="${baseURL}/" style="width:480px;height:200px"></iframe>`,
  );
  const embed = page.frameLocator('#embed');
  await expect(embed.getByText('All systems operational')).toBeVisible({ timeout: 15_000 });
  await expect(embed.getByRole('link', { name: /E2E status →/ })).toHaveAttribute('target', '_blank');
  // The full page refuses to render inside a frame.
  await expect(page.frameLocator('#page').getByText('All systems operational')).toHaveCount(0);
  await close();
});

test('the widget script loads on another site and shows an open incident', async ({ page, baseURL }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/);
  const created = await page.request.post('/api/v1/admin/incidents', {
    data: {
      title: 'Widget test incident',
      message: 'Shown on other sites.',
      impact: 'degraded',
      notify: false,
    },
  });
  const { id } = (await created.json()) as { id: string };
  try {
    const close = await otherSite(
      page,
      `<h1>Some blog</h1><script type="module" src="${baseURL}/widget.js"></script>`,
    );
    const box = page.locator('[data-heartline-widget]');
    await expect(box.getByText('Widget test incident')).toBeVisible({ timeout: 15_000 });
    await expect(box.getByRole('link', { name: /E2E status/ })).toHaveAttribute(
      'href',
      new RegExp(`/incidents/${id}$`),
    );
    await close();
  } finally {
    await page.request.post(`/api/v1/admin/incidents/${id}/updates`, {
      data: { status: 'resolved', message: 'Done.', notify: false },
    });
  }
});
