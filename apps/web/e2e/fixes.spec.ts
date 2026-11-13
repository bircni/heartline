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

test('admin dialogs: deleting asks in a dialog, failures show as toasts, fields show errors', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);

  // A server-side validation error is shown next to its field.
  await page.getByRole('button', { name: 'New monitor' }).click();
  await page.getByRole('button', { name: 'TCP', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Dialog test');
  await page.getByLabel('ID', { exact: true }).fill('dialog-test');
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill('3100');
  await page.getByLabel('Interval').fill('soon');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Check the highlighted fields.')).toBeVisible();
  await page.getByLabel('Interval').fill('30s');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Dialog test' })).toBeVisible();

  // Cancelling keeps the monitor.
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Dialog test?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // A failed delete shows a toast.
  await page.route('**/api/v1/admin/monitors/dialog-test', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Disk on fire"}' })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete monitor' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Disk on fire' })).toBeVisible();
  await page.unroute('**/api/v1/admin/monitors/dialog-test');

  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete monitor' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deleted Dialog test' })).toBeVisible();
});

test('the audit log lists admin changes', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  // The dialog test before this one created and deleted a monitor.
  await expect(page.getByText('Deleted monitor Dialog test')).toBeVisible();
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByText('Deleted monitor Dialog test')).toBeHidden();
});
