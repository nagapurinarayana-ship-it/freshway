import { test, expect } from '@playwright/test';

const workerOrigin = 'http://localhost:8787';
const pageOrigin = 'http://localhost:4173';

async function proxyOwnerAssets(page) {
  await page.route(url => url.pathname.startsWith('/admin/'), async route => {
    const incoming = new URL(route.request().url());
    let targetPath = incoming.pathname;
    if (targetPath !== '/admin/sw.js' &&
        targetPath !== '/admin/manifest.webmanifest' &&
        !targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.replace(/^\/admin(?=\/)/, '');
    } else if (targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.replace(/^\/admin\/icons\//, '/icons/');
    }
    const response = await route.fetch({ url: pageOrigin + targetPath + incoming.search });
    await route.fulfill({ response });
  });
}

async function proxyWorkerApi(page) {
  await page.route('**/api/**', async route => {
    const incoming = new URL(route.request().url());
    const response = await route.fetch({ url: workerOrigin + incoming.pathname + incoming.search });
    await route.fulfill({ response });
  });
}

test('Owner account deletion completion uses an explicit mobile form and never writes before valid submission', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const patchRequests = [];
  const dialogs = [];
  const pageErrors = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', async dialog => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });

  try {
    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);

    // The deletion queue is stubbed. No deletion request or production-like data is written.
    await page.route('**/api/admin/account-deletion-requests**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/admin/account-deletion-requests' && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requests: [{
              id: 'isolated-delete-request',
              status: 'in_review',
              phone_last4: '1234',
              source: 'signed_in_customer',
              created_at: '2026-11-05 12:00:00',
              updated_at: '2026-11-05 12:00:00',
              admin_note: null
            }],
            summary: { pending: 0, in_review: 1, rejected: 0, completed: 0, latestCompletedAt: null }
          })
        });
        return;
      }
      if (url.pathname === '/api/admin/account-deletion-requests/isolated-delete-request' && request.method() === 'PATCH') {
        patchRequests.push({
          method: request.method(),
          body: JSON.parse(request.postData() || '{}')
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        });
        return;
      }
      await route.fallback();
    });

    const home = await page.goto('/admin.html#settings');
    expect(home?.status()).toBe(200);
    await expect(page.locator('#loginView')).toBeVisible();

    const loginResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/login' &&
      response.request().method() === 'POST'
    );
    await page.locator('#adminToken').fill('isolated-admin-token');
    await page.locator('#connectBtn').click();
    expect((await loginResponse).status()).toBe(200);
    await expect(page.locator('#appView')).toBeVisible();

    // The queue intentionally waits for the Owner auth hint before reading account data.
    await page.evaluate(() => sessionStorage.setItem('freshway-admin-auth', '1'));
    await page.locator('[data-screen="settings"]').first().click();
    await expect(page.locator('#settings')).toHaveClass(/active/);
    await page.locator('#accountDeletionRefresh').click();
    await expect(page.locator('[data-deletion-request="isolated-delete-request"]')).toContainText('Mobile ending 1234');
    const card = page.locator('[data-deletion-request="isolated-delete-request"]');
    await card.locator('[data-deletion-action="completed"]').click();

    const form = card.locator('[data-deletion-form]');
    await expect(form).toBeVisible();
    await expect(form).toContainText('deletes the individual request record');
    await expect(form).toContainText('aggregate completion count');
    await expect(form.locator('[data-deletion-note]')).toBeVisible();
    await expect(form.locator('[data-deletion-retention-confirm]')).toBeVisible();
    await expect(form.locator('[data-deletion-submit]')).toBeVisible();
    expect(patchRequests).toHaveLength(0);
    expect(dialogs).toHaveLength(0);

    // Invalid submit remains inline and must not make an API write.
    await form.locator('[data-deletion-submit]').click();
    await expect(form.locator('[data-deletion-form-error]')).toBeVisible();
    expect(patchRequests).toHaveLength(0);

    const auditNote = 'Invoice and transaction records retained under the confirmed accounting retention policy.';
    await form.locator('[data-deletion-note]').fill(auditNote);
    await form.locator('[data-deletion-retention-confirm]').check();
    await form.locator('[data-deletion-submit]').click();

    await expect.poll(() => patchRequests.length).toBe(1);
    expect(patchRequests[0]).toEqual({
      method: 'PATCH',
      body: { status: 'completed', adminNote: auditNote }
    });
    await expect(page.locator('#accountDeletionStatusMessage')).toContainText('Deletion completed');
    expect(dialogs).toHaveLength(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
