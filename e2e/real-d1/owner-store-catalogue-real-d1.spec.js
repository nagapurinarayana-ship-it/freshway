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

    const response = await route.fetch({
      url: pageOrigin + targetPath + incoming.search
    });
    await route.fulfill({ response });
  });
}


async function proxyWorkerApi(page) {
  await page.route('**/api/**', async route => {
    const incoming = new URL(route.request().url());
    const target = workerOrigin + incoming.pathname + incoming.search;
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });
}

test('Owner can edit, save and reload store-specific catalogue using real Worker + isolated D1', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  const inventoryWrites = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/api/admin/delivery/stores/') &&
        url.pathname.endsWith('/inventory') &&
        request.method() === 'PATCH') {
      inventoryWrites.push(request.url());
    }
  });

  try {
    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);
    const home = await page.goto('/admin.html#stores');
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
    await expect(page.locator('#stores')).toHaveClass(/active/);
    await expect(page.locator('#storeManagement .fw-store-card')).toContainText('D1 Store');

    await page.locator('#storeManagement [data-manage-store="store-d1"]').click();
    await expect(page.locator('#storeManagement .fw-store-management-heading h2')).toHaveText('D1 Store');
    const oilVisible = page.locator('#storeManagement [data-catalogue-available="oil-d1"]');
    const oilPrice = page.locator('#storeManagement [data-catalogue-price="oil-d1"]');
    const riceVisible = page.locator('#storeManagement [data-catalogue-available="rice-d1"]');
    const ricePrice = page.locator('#storeManagement [data-catalogue-price="rice-d1"]');

    await expect(oilVisible).toBeVisible();
    await expect(oilVisible).toBeChecked();
    await expect(oilPrice).toHaveValue('189');
    await expect(riceVisible).toBeChecked();
    await expect(ricePrice).toHaveValue('233');

    try {
      await oilPrice.fill('199');
      await riceVisible.uncheck();

      const catalogueSaveResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/admin/delivery/stores/store-d1/catalogue' &&
        response.request().method() === 'PATCH'
      );
      const inventorySaveResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/admin/delivery/stores/store-d1/inventory' &&
        response.request().method() === 'PATCH'
      );
      await page.locator('#storeManagement [data-save-catalogue]').click();
      const [catalogueSaved, inventorySaved] = await Promise.all([
        catalogueSaveResponse,
        inventorySaveResponse
      ]);
      expect(catalogueSaved.status()).toBe(200);
      expect(inventorySaved.status()).toBe(200);
      await expect(page.locator('#storeManagement [data-store-management-status]')).toContainText('saved');

      await page.locator('#storeManagement [data-close-catalogue]').click();
      await page.locator('#storeManagement [data-manage-store="store-d1"]').click();

      await expect(page.locator('#storeManagement [data-catalogue-available="oil-d1"]')).toBeChecked();
      await expect(page.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('199');
      await expect(page.locator('#storeManagement [data-catalogue-available="rice-d1"]')).not.toBeChecked();
    } finally {
      // Restore the isolated fixture to its original state so the customer checkout
      // tests start with oil at ₹189 and rice visible, even after an assertion fails.
      const close = page.locator('#storeManagement [data-close-catalogue]');
      if (await close.count()) {
        await close.click();
        // The in-app Back action now follows the browser history entry. Wait for
        // the Stores list to finish reloading before checking/restoring the fixture.
        await expect(page.locator('#storeManagement [data-manage-store="store-d1"]')).toBeVisible({ timeout: 10000 });
      }
      const open = page.locator('#storeManagement [data-manage-store="store-d1"]');
      if (await open.count()) {
        await open.click();
        const originalOilVisible = page.locator('#storeManagement [data-catalogue-available="oil-d1"]');
        const originalOilPrice = page.locator('#storeManagement [data-catalogue-price="oil-d1"]');
        const originalRiceVisible = page.locator('#storeManagement [data-catalogue-available="rice-d1"]');
        await expect(originalOilVisible).toBeVisible({ timeout: 10000 });
        await expect(originalOilPrice).toBeVisible({ timeout: 10000 });
        await expect(originalRiceVisible).toBeVisible({ timeout: 10000 });
        await originalOilVisible.check();
        await originalOilPrice.fill('189');
        await originalRiceVisible.check();
        const restoreCatalogueResponse = page.waitForResponse(response =>
          new URL(response.url()).pathname === '/api/admin/delivery/stores/store-d1/catalogue' &&
          response.request().method() === 'PATCH'
        );
        const restoreInventoryResponse = page.waitForResponse(response =>
          new URL(response.url()).pathname === '/api/admin/delivery/stores/store-d1/inventory' &&
          response.request().method() === 'PATCH'
        );
        await page.locator('#storeManagement [data-save-catalogue]').click();
        const [catalogueRestored, inventoryRestored] = await Promise.all([
          restoreCatalogueResponse,
          restoreInventoryResponse
        ]);
        expect(catalogueRestored.status()).toBe(200);
        expect(inventoryRestored.status()).toBe(200);
      }
    }

    expect(inventoryWrites).toHaveLength(2, 'the unified Save button must persist inventory alongside catalogue settings');
    expect(inventoryWrites.every(url => url.includes('/stores/store-d1/inventory'))).toBe(true, 'inventory writes must remain scoped to the selected store');
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, '::before').visibility)).toBe('hidden');
    await page.screenshot({ path: 'test-results/real-d1/owner-store-catalogue.png', fullPage: true });
  } finally {
    await context.close();
  }
});
