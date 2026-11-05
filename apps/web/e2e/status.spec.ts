import { expect, test } from '@playwright/test';

const ADMIN = { email: 'admin@e2e.local', password: 'e2e-admin-password' };

test('public overview shows services, day bars and details', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('All systems operational').first()).toBeVisible({ timeout: 15_000 });
  const row = page.getByRole('link', { name: /Status API: operational/ });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: '30D' }).click();
  await expect(page).toHaveURL(/days=30/);
  await row.click();
  await expect(page.getByRole('heading', { name: /Status API/ })).toBeVisible();
  await expect(page.getByText('Recent checks')).toBeVisible();
  await expect(page.getByText('HTTP 200').first()).toBeVisible();
});

test('admin flow: monitor, incident and token', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);
  await expect(page.getByText('Managed in')).toBeVisible();

  // Create a UI-managed monitor and run it.
  await page.getByRole('button', { name: 'New monitor' }).click();
  await page.getByRole('button', { name: 'TCP', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Loopback port');
  await page.getByLabel('ID', { exact: true }).fill('loopback');
  await page.getByLabel('Group').fill('Extra');
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill('3100');
  await page.getByRole('button', { name: 'Create' }).click();
  // After creating, the editor switches to the new monitor.
  await expect(page.getByRole('heading', { level: 2, name: 'Loopback port' })).toBeVisible();
  await page.getByRole('button', { name: 'Run check now' }).click();
  await expect(page.getByRole('status').getByText(/^up/)).toBeVisible();

  // Declare an incident; it shows up on the public page.
  await page.getByRole('link', { name: 'Incidents' }).click();
  await page.getByRole('button', { name: 'Declare incident' }).click();
  await page.getByLabel('Title').fill('Database maintenance overran');
  await page.getByRole('button', { name: 'Status API' }).click();
  await page.getByLabel('First update (public)').fill('We are looking into slow responses.');
  await page.getByRole('button', { name: 'Declare', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Database maintenance overran' })).toBeVisible();
  await page.getByPlaceholder('What changed? This is shown publicly.').fill('Fixed.');
  await page.getByRole('button', { name: 'Resolved' }).click();
  await page.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByText('Fixed.')).toBeVisible();

  // Generate an API token and use it.
  await page.getByRole('link', { name: 'API tokens' }).click();
  await page.getByLabel('Name', { exact: true }).fill('e2e');
  await page.getByRole('button', { name: 'Generate token' }).click();
  const token = (await page.getByRole('status').locator('code').textContent()) ?? '';
  expect(token).toMatch(/^hl_/);
  const res = await page.request.get('/api/v1/admin/monitors', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).map((m: { id: string }) => m.id)).toContain('loopback');

  await page.goto('/');
  await expect(page.getByText('Loopback port').first()).toBeVisible();
});

test('software inventory shows the probed version and degrades without data sources', async ({ page }) => {
  // Anonymous visitors see nothing about versions by default.
  await page.goto('/services/self-http');
  await expect(page.getByRole('heading', { name: /Status API/ })).toBeVisible();
  await expect(page.getByText('Recent checks')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Software/ })).toHaveCount(0);

  await page.goto('/login');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Software' }).click();
  await expect(page.getByRole('heading', { name: 'Software' })).toBeVisible();
  const row = page.getByRole('button', { name: /Status API/ });
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('status').getByText('Refreshed.')).toBeVisible();
  // The catalog probe reads /api/v1/version of the server itself.
  await expect(row.getByText(/^\d+\.\d+\.\d+/)).toBeVisible();
  // No data sources are reachable in e2e and heartline has no advisory source: nothing crashes and the
  // service is scored by what is known (nothing), with the missing source named in the reasons.
  await expect(row.getByText('Up to date')).toBeVisible();
  await expect(page.getByText('no vulnerability source known for heartline')).toBeVisible();

  await page.goto('/services/self-http');
  await expect(page.getByRole('heading', { name: /^Software/ })).toBeVisible();
  await expect(page.getByText('No known vulnerabilities')).toBeVisible();
});

test('theme toggle persists', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const wasDark = await html.evaluate((el) => el.classList.contains('dark'));
  await page
    .getByRole('button', { name: /Switch to (light|dark) mode/ })
    .first()
    .click();
  await page.reload();
  expect(await html.evaluate((el) => el.classList.contains('dark'))).toBe(!wasDark);
});
