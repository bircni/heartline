import { expect, test } from '@playwright/test';

test('a service opened from the overview uses its own 30-day default', async ({ page }) => {
  await page.goto('/');
  const row = page.getByRole('link', { name: /Status API: Operational/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page).toHaveURL(/\/services\/self-http$/);
  await expect(page.getByText('Uptime, 30 days')).toBeVisible();
});

test('editors cannot open the users page by URL', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('editor@e2e.local');
  await page.getByLabel('Password').fill('e2e-editor-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/admin\/monitors/);
});
