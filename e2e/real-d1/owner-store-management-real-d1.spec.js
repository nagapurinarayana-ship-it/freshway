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

async function ownerApi(page, path, method = 'GET', payload) {
  return page.evaluate(async ({ path, method, payload }) => {
    const response = await fetch('/api' + path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }, { path, method, payload });
}

test('Owner manages prices and inventory together without mixing store data', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  const unauthorizedResponses = [];
  const inventoryWrites = [];
  let secondStoreId = '';

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && [401, 403].includes(response.status())) {
      unauthorizedResponses.push({ status: response.status(), path: url.pathname });
    }
  });
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

    // Read Store One's existing values before creating a second, independently managed store.
    const firstInventoryResult = await ownerApi(page, '/admin/delivery/stores/store-d1/inventory');
    expect(firstInventoryResult.status).toBe(200);
    const firstTracked = firstInventoryResult.data.inventory.find(item => Number(item.stock_managed) === 1);
    expect(firstTracked, 'the isolated D1 fixture must contain at least one stock-managed product').toBeTruthy();
    const firstStockBefore = Number(firstTracked.on_hand);

    const created = await ownerApi(page, '/admin/delivery/stores', 'POST', {
      name: 'D1 Store Two ' + Date.now(),
      address: 'Second test store, Hyderabad',
      latitude: 17.385044,
      longitude: 78.486671,
      serviceRadiusKm: 5
    });
    expect(created.status).toBe(201);
    secondStoreId = created.data.store.id;
    expect(secondStoreId).toBeTruthy();

    const secondCatalogueResult = await ownerApi(page, '/admin/delivery/stores/' + encodeURIComponent(secondStoreId) + '/catalogue');
    const secondInventoryResult = await ownerApi(page, '/admin/delivery/stores/' + encodeURIComponent(secondStoreId) + '/inventory');
    expect(secondCatalogueResult.status).toBe(200);
    expect(secondInventoryResult.status).toBe(200);

    const secondCatalogueItems = secondCatalogueResult.data.items.map(item => ({
      productId: item.id,
      isAvailable: item.id === 'oil-d1' ? true : (item.id === 'rice-d1' ? false : item.isAvailable),
      priceOverride: item.id === 'oil-d1' ? 299 : item.priceOverride
    }));
    const secondCatalogueSave = await ownerApi(
      page,
      '/admin/delivery/stores/' + encodeURIComponent(secondStoreId) + '/catalogue',
      'PATCH',
      { items: secondCatalogueItems }
    );
    expect(secondCatalogueSave.status).toBe(200);

    const secondTracked = secondInventoryResult.data.inventory.find(item => Number(item.stock_managed) === 1);
    expect(secondTracked, 'the second store must receive its own tracked inventory rows').toBeTruthy();
    const secondTargetQuantity = 23;
    const secondInventoryItems = secondInventoryResult.data.inventory
      .filter(item => Number(item.stock_managed) === 1)
      .map(item => ({
        productId: item.id,
        stockQuantity: item.id === secondTracked.id ? secondTargetQuantity : Number(item.on_hand)
      }));
    const secondInventorySave = await ownerApi(
      page,
      '/admin/delivery/stores/' + encodeURIComponent(secondStoreId) + '/inventory',
      'PATCH',
      { items: secondInventoryItems }
    );
    expect(secondInventorySave.status).toBe(200);

    await page.evaluate(() => window.FreshWayOwnerStoreManagement.load());
    await expect(page.locator('#storeManagement [data-manage-store="store-d1"]')).toBeVisible();
    await expect(page.locator('#storeManagement [data-manage-store="' + secondStoreId + '"]')).toBeVisible();

    // Store One must continue to show its original per-store price and stock.
    await page.locator('#storeManagement [data-manage-store="store-d1"]').click();
    const firstOilPrice = page.locator('#storeManagement [data-catalogue-price="oil-d1"]');
    await expect(firstOilPrice).toHaveValue('189');
    const firstStockInput = page.locator('#storeManagement [data-inventory-product="' + firstTracked.id + '"]');
    await expect(firstStockInput).toHaveValue(String(firstStockBefore));

    await page.locator('#storeManagement [data-close-store-management]').click();

    // Store Two must show its own price and stock, not the values from Store One.
    await page.locator('#storeManagement [data-manage-store="' + secondStoreId + '"]').click();
    await expect(page.locator('#storeManagement .fw-store-management-heading h2')).toContainText('D1 Store Two');
    await expect(page.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('299');
    const secondStockInput = page.locator('#storeManagement [data-inventory-product="' + secondTracked.id + '"]');
    await expect(secondStockInput).toHaveValue(String(secondTargetQuantity));

    // The single Save action persists both edits to the selected store.
    await page.locator('#storeManagement [data-catalogue-price="oil-d1"]').fill('309');
    await secondStockInput.fill('25');
    const catalogueSave = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores/' + secondStoreId + '/catalogue' &&
      response.request().method() === 'PATCH'
    );
    const inventorySave = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/delivery/stores/' + secondStoreId + '/inventory' &&
      response.request().method() === 'PATCH'
    );
    await page.locator('#storeManagement [data-save-store-management]').click();
    expect((await catalogueSave).status()).toBe(200);
    expect((await inventorySave).status()).toBe(200);
    await expect(page.locator('#storeManagement [data-store-management-status]')).toContainText('saved');

    await page.locator('#storeManagement [data-close-store-management]').click();
    await page.locator('#storeManagement [data-manage-store="' + secondStoreId + '"]').click();
    await expect(page.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('309');
    await expect(page.locator('#storeManagement [data-inventory-product="' + secondTracked.id + '"]')).toHaveValue('25');

    await page.locator('#storeManagement [data-close-store-management]').click();
    await page.locator('#storeManagement [data-manage-store="store-d1"]').click();
    await expect(page.locator('#storeManagement [data-catalogue-price="oil-d1"]')).toHaveValue('189');
    await expect(page.locator('#storeManagement [data-inventory-product="' + firstTracked.id + '"]')).toHaveValue(String(firstStockBefore));

    expect(inventoryWrites.length).toBeGreaterThanOrEqual(2);
    expect(inventoryWrites.every(url => url.includes('/stores/' + secondStoreId + '/inventory'))).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(unauthorizedResponses, 'the Owner store flow must not generate unauthorized API responses').toEqual([]);
    await page.screenshot({ path: 'test-results/real-d1/owner-store-management.png', fullPage: true });

    // Mobile: product controls must stack cleanly, the save action must span its footer, and the page must not scroll sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#storeManagement .fw-store-management-panel')).toBeVisible();
    const mobileLayout = await page.evaluate(() => {
      const panel = document.querySelector('#storeManagement .fw-store-management-panel');
      const footer = document.querySelector('#storeManagement .fw-store-management-save');
      const button = footer?.querySelector('[data-save-store-management]');
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        panelWidth: panel?.clientWidth || 0,
        panelScrollWidth: panel?.scrollWidth || 0,
        footerWidth: footer?.clientWidth || 0,
        buttonWidth: button?.getBoundingClientRect().width || 0
      };
    });
    expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewport + 1);
    expect(mobileLayout.panelScrollWidth).toBeLessThanOrEqual(mobileLayout.panelWidth + 1);
    expect(mobileLayout.buttonWidth).toBeGreaterThanOrEqual(mobileLayout.footerWidth - 2);
    await page.screenshot({ path: 'test-results/real-d1/owner-store-management-mobile.png', fullPage: true });

    // Narrow tablet: the desktop three-column minimums must not force horizontal overflow beside the fixed sidebar.
    await page.setViewportSize({ width: 810, height: 900 });
    const tabletLayout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panel: document.querySelector('#storeManagement .fw-store-management-panel'),
      controls: document.querySelector('#storeManagement .fw-managed-product-controls')
    }));
    expect(tabletLayout.documentWidth).toBeLessThanOrEqual(tabletLayout.viewport + 1);
    expect(tabletLayout.controls).toBeTruthy();
    await page.screenshot({ path: 'test-results/real-d1/owner-store-management-tablet.png', fullPage: true });
  } finally {
    if (secondStoreId) {
      await ownerApi(page, '/admin/delivery/stores/' + encodeURIComponent(secondStoreId), 'PATCH', {
        isActive: false
      }).catch(() => {});
    }
    await context.close();
  }
});
