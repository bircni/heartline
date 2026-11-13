import { expect, test } from '@playwright/test';

test('visitors can collapse a group and the choice is remembered', async ({ page }) => {
  await page.goto('/');
  const row = page.getByRole('link', { name: /Status API: Operational/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  const toggle = page.getByRole('button', { name: 'Core', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(row).toBeHidden();
  await expect(page.getByText('2 services')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Core', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Core', exact: true }).click();
  await expect(page.getByRole('link', { name: /Status API: Operational/ })).toBeVisible();
});

test('admins create, edit and delete groups', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);
  await page.getByRole('link', { name: 'Groups' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  await page.getByLabel('Name').fill('Lab');
  await page.getByLabel('Description (public)').fill('Experiments');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Created Lab' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Lab' }).click();
  await page.getByLabel('Name').fill('Laboratory');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit Laboratory' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Laboratory' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete group' }).click();
  await expect(page.getByRole('button', { name: 'Edit Laboratory' })).toBeHidden();
});
