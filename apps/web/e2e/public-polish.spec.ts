import { expect, test } from '@playwright/test';

const PRIVATE = 'http://127.0.0.1:3101';

test('a private status page asks visitors to sign in and returns them afterwards', async ({ page }) => {
  await page.goto(`${PRIVATE}/incidents`);
  await expect(page.getByRole('heading', { name: 'Sign in to see the status' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Subscribe' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in' }).last().click();
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${PRIVATE}/incidents`);
  await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
});

test('times are shown in the site time zone, with a label', async ({ page }) => {
  // The browser runs in another zone than the site (Pacific/Auckland).
  await page.goto(`${PRIVATE}/login`);
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.getByRole('link', { name: 'Maintenance' }).click();
  await expect(page.getByText(/^Starts \((NZDT|NZST|GMT\+1[23])\)$/)).toBeVisible();
});

test('the incident history filters and the theme can follow the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/incidents');
  await expect(page.getByRole('searchbox', { name: 'Search incidents' })).toBeVisible();
  await expect(page.getByText(/^Times in UTC/)).toBeVisible();
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  const html = page.locator('html');
  await expect(html).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(html).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/dark/);
});
