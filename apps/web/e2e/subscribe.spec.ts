import { expect, test } from '@playwright/test';

test('visitors sign up for e-mails, and e-mail links ask before changing anything', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Subscribe' }).click();
  await expect(page).toHaveURL(/\/subscribe$/);
  await page.getByLabel('E-mail address').fill('visitor@example.com');
  await page.getByLabel('Only these:').check();
  await page.getByLabel('Status API').check();
  await page.getByRole('button', { name: 'Subscribe' }).click();
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
