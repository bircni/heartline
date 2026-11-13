import { expect, test } from '@playwright/test';

test('a maintenance window has a public page and takes status updates', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);

  // Created through the API so it is already running; the UI form schedules future windows.
  const now = Date.now();
  const res = await page.request.post('/api/v1/admin/maintenance', {
    data: {
      title: 'Switch firmware',
      description: 'Ports **flap** for a minute.',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      services: ['self-tcp'],
      notify: false,
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };

  await page.getByRole('link', { name: 'Maintenance' }).first().click();
  await page.getByRole('button', { name: 'Edit Switch firmware' }).click();
  await page.getByRole('button', { name: 'Verifying', exact: true }).click();
  await page.getByLabel('Update message').fill('Checking all ports.');
  await page.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Update posted' })).toBeVisible();

  await page.goto(`/maintenance/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Switch firmware' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Verifying' }).first()).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(page.locator('strong', { hasText: 'flap' })).toBeVisible();
  await expect(page.getByText('Checking all ports.')).toBeVisible();

  // Done early: the service leaves maintenance at once.
  await page.request.post(`/api/v1/admin/maintenance/${id}/updates`, {
    data: { status: 'completed', message: 'Done.', notify: false },
  });
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Completed' }).first()).toHaveAttribute(
    'aria-current',
    'step',
  );
});
