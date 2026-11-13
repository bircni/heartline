import { expect, test } from '@playwright/test';

test('a push monitor shows its URL once and turns operational on a push', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);

  await page.getByRole('button', { name: 'New monitor' }).click();
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Nightly job');
  await page.getByLabel('ID', { exact: true }).fill('nightly');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Copy it now. It won’t be shown again.')).toBeVisible();
  const url =
    (await page
      .locator('code')
      .filter({ hasText: /^http.*\/api\/v1\/push\/hlp_/ })
      .first()
      .textContent()) ?? '';
  expect(url).toMatch(/\/api\/v1\/push\/hlp_/);

  const res = await page.request.get(`${url}?msg=done`);
  expect(await res.json()).toEqual({ ok: true, status: 'up' });
  await page.reload();
  await page.getByRole('button', { name: /Nightly job/ }).click();
  await expect(page.getByText(/Last push .* \(up\)/)).toBeVisible();
  await expect(page.getByText('Copy it now.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete monitor' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deleted Nightly job' })).toBeVisible();
});
