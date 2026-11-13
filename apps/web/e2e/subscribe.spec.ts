import { expect, test } from '@playwright/test';

test('visitors sign up for e-mails, and e-mail links ask before changing anything', async ({ page }) => {
  await page.goto('/');
  // The header button opens a dialog with e-mail and feed tabs.
  await page.getByRole('button', { name: 'Subscribe' }).click();
  const dialog = page.getByRole('dialog', { name: 'Subscribe to updates' });
  await dialog.getByRole('button', { name: 'Atom / RSS' }).click();
  await expect(dialog.getByText(/\/api\/v1\/incidents\.atom$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.goto('/subscribe');
  await page.getByLabel('E-mail address').fill('visitor@example.com');
  await page.getByLabel('Only these:').check();
  await page.getByLabel('Status API').check();
  await page.locator('form').getByRole('button', { name: 'Subscribe' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Atom feed' })).toHaveAttribute(
    'href',
    '/api/v1/incidents.atom',
  );

  // Opening a confirmation link does nothing by itself; a forged one is refused.
  await page.goto('/subscriptions/confirm?t=bm9wZQ.forged');
  await expect(page.getByRole('heading', { name: 'Confirm your subscription' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm subscription' }).click();
  await expect(page.getByRole('alert')).toContainText('invalid or has expired');
  await page.goto('/subscriptions/manage?t=bm9wZQ.forged');
  await expect(page.getByRole('alert')).toContainText('invalid or has expired');

  const feed = await page.request.get('/api/v1/incidents.atom');
  expect(feed.headers()['content-type']).toContain('application/atom+xml');
});

test('the overview shows status labels, past incidents and open incidents as boxes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Status API: Operational/ })).toContainText('Operational', {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: 'Past incidents' })).toBeVisible();
  await expect(
    page.getByText(/No incidents reported today\.|Database maintenance overran/).first(),
  ).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/);
  const created = await page.request.post('/api/v1/admin/incidents', {
    data: { title: 'Box test', message: 'First update of the box.', impact: 'degraded', notify: false },
  });
  const { id } = (await created.json()) as { id: string };
  try {
    const visitor = await page.context().browser()!.newPage();
    await visitor.goto('/');
    const box = visitor.getByRole('region', { name: 'Box test' });
    await expect(box).toBeVisible();
    await expect(box.getByText('First update of the box.')).toBeVisible();
    await visitor.close();
  } finally {
    await page.request.post(`/api/v1/admin/incidents/${id}/updates`, {
      data: { status: 'resolved', message: 'Done.', notify: false },
    });
  }
});
