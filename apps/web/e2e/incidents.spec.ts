import { expect, test } from '@playwright/test';

// Other specs expect every service to be operational: resolve what this one leaves open, even when it fails.
test.afterEach(async ({ page }) => {
  const open = (await (await page.request.get('/api/v1/incidents?active=true')).json()) as { id: string }[];
  for (const i of open)
    await page.request.post(`/api/v1/admin/incidents/${i.id}/updates`, {
      data: { status: 'resolved', message: 'Cleaned up after the test.', notify: false, services: [] },
    });
});

test('an incident sets service statuses, renders Markdown and publishes a postmortem', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/monitors/);

  await page.getByRole('link', { name: 'Incidents' }).click();
  await page.getByRole('button', { name: 'Declare incident' }).click();
  await page.getByLabel('Title').fill('Port flapping');
  await page.getByRole('button', { name: 'Status port', exact: true }).click();
  await page.getByLabel('Status of Status port').selectOption('partial');
  await expect(page.getByRole('button', { name: 'Auto: Partial outage' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('First update (public)').fill('Connections **drop** now and then.');
  await page.getByRole('button', { name: 'Declare', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Port flapping' })).toBeVisible();

  // Visitors see the service's status from the incident.
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto('/');
  await expect(visitor.getByRole('link', { name: /Status port: Partial outage/ })).toBeVisible({
    timeout: 15_000,
  });
  await visitor.close();

  await page.getByLabel('Postmortem').fill('## Cause\nA loose cable.');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Postmortem published' })).toBeVisible();

  await page.getByPlaceholder('What changed? This is shown publicly.').fill('Cable replaced.');
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await page.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Update posted' })).toBeVisible();

  await page.goto('/incidents');
  await page
    .getByRole('link', { name: /Port flapping/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Postmortem' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cause' })).toBeVisible();
  await expect(page.locator('strong', { hasText: 'drop' })).toBeVisible();
  await expect(page.getByText('Partial outage → ')).toBeVisible();
});
