import { expect, test } from '@playwright/test';

const ADMIN = { email: 'admin@e2e.local', password: 'e2e-admin-password' };

test('visitors get the centred page with the availability graph, a timeline and date ranges', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'All systems operational' })).toBeVisible({
    timeout: 15_000,
  });
  // No sidebar for visitors, sign-in in the header.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

  // The graph is the default view; the timeline choice survives a reload.
  const row = page.getByRole('link', { name: /Status API: Operational/ });
  await expect(row.locator('svg path[stroke="var(--ok)"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(row.locator('svg')).toHaveCount(1); // only the status icon is left
  await page.reload();
  await expect(page.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Graph' }).click();

  // A custom range ends the history on the chosen day.
  await page.getByRole('button', { name: /–/ }).click();
  await page.getByLabel('From').fill('2026-01-01');
  await page.getByLabel('To').fill('2026-01-31');
  await page.getByRole('button', { name: 'Show range' }).click();
  await expect(page).toHaveURL(/days=31&to=2026-01-31/);
  // The button names the range, e.g. "Jan 1 – Jan 31, 2026" (the format follows the browser's locale).
  await expect(page.getByRole('button', { name: /Jan 31, 2026|31\. Jan/ })).toBeVisible();

  // A day that does not exist is dropped instead of breaking the page.
  await page.goto('/?to=2026-02-31');
  await expect(page.getByRole('heading', { level: 1, name: 'All systems operational' })).toBeVisible();
});

test('signed-in users get one sidebar with the status page, management and services', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);

  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Overview', 'Incidents', 'Monitors', 'Software', 'API tokens', 'Users', 'Status API'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();

  // The sidebar stays when moving to the status page.
  await nav.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'All systems operational' })).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(page.getByText('E2E Admin', { exact: true })).toBeVisible();

  // The colour theme is the viewer's own choice and is kept.
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('button', { name: 'Violet' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');

  // An open incident is listed in the banner and can be managed from its public page.
  await nav.getByRole('link', { name: 'Incidents', exact: true }).click();
  await page.getByRole('button', { name: 'Declare incident' }).click();
  await page.getByLabel('Title').fill('Disk filling up');
  await page.getByRole('button', { name: 'Status API', exact: true }).click();
  await page.getByLabel('First update (public)').fill('Cleaning up old snapshots.');
  await page.getByRole('button', { name: 'Declare', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Disk filling up' })).toBeVisible();
  await nav.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: /Disk filling up/ }).click();
  await page.getByRole('link', { name: 'Manage incident' }).click();
  await expect(page).toHaveURL(/\/admin\/incidents\?incident=/);
  await expect(page.getByRole('heading', { name: 'Disk filling up' })).toBeVisible();

  // While it is open the incident sets the service's status; resolving gives it back to the check.
  await page.getByPlaceholder('What changed? This is shown publicly.').fill('Space freed.');
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await page.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Update posted' })).toBeVisible();
});
