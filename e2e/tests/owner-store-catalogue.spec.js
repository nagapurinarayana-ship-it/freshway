import { test, expect } from '@playwright/test';

const catalogue = [
  {
    id: 'oil-1', name: 'Groundnut Oil', unit: 'litre',
    centralPrice: 220, priceOverride: null, storePrice: 220,
    isAvailable: true, stockManaged: true, onHand: 10, reservedQty: 2, categoryName: 'Oils'
  },
  {
    id: 'rice-1', name: 'Basmati Rice', unit: 'kg',
    centralPrice: 150, priceOverride: 145, storePrice: 145,
    isAvailable: true, stockManaged: true, onHand: 8, reservedQty: 1, categoryName: 'Rice'
  },
  {
    id: 'oil-2', name: 'Sesame Oil', unit: 'litre',
    centralPrice: 280, priceOverride: 260, storePrice: 260,
    isAvailable: true, stockManaged: false, onHand: 0, reservedQty: 0, categoryName: 'Oils'
  }
];

test('Owner can edit per-store product visibility and prices without changing inventory', async ({ page }) => {
  const apiCalls = [];
  let savedItems = catalogue.map(item => ({ ...item }));

  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', error => apiCalls.push({ type: 'pageerror', message: error.message }));

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const send = (data, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(data)
    });

    apiCalls.push({ method, path, body: method === 'GET' ? null : request.postDataJSON() });

    if (path === '/api/admin/login' && method === 'POST') return send({ ok: true });
    if (path === '/api/admin/summary' && method === 'GET') {
      return send({ newOrders: 0, processing: 0, deliveryToday: 0, cashPending: 0 });
    }
    if (path === '/api/admin/reports' && method === 'GET') {
      return send({
        sales: 0, orders: 0, cashPending: 0, cashPendingOrders: 0,
        delivered: 0, deliveredSales: 0, customers: 0, newCustomers: 0,
        aov: 0, eligibleOrders: 0, cancelled: 0, cancelledValue: 0,
        cashCollected: 0, cashCollectedOrders: 0, repeatOrders: 0,
        topProducts: [], topCustomers: []
      });
    }
    if (path === '/api/admin/orders' && method === 'GET') {
      return send({ orders: [], pagination: { total: 0, page: 1, limit: 25 } });
    }
    if (path === '/api/admin/customers' && method === 'GET') {
      return send({ customers: [], pagination: { total: 0, page: 1, limit: 25 } });
    }
    if (path === '/api/admin/products' && method === 'GET') return send({ products: [] });

    if (path === '/api/admin/delivery/stores' && method === 'GET') {
      return send({ stores: [{
        id: 'store-1', name: 'Kukatpally Store',
        address: 'Kukatpally, Hyderabad', latitude: 17.385, longitude: 78.487,
        service_radius_km: 5, is_active: 1, pending_order_count: 0
      }] });
    }
    if (path === '/api/admin/delivery/stores/store-1/catalogue' && method === 'GET') {
      return send({ items: savedItems });
    }
    if (path === '/api/admin/delivery/stores/store-1/catalogue' && method === 'PATCH') {
      const payload = request.postDataJSON();
      savedItems = payload.items.map(item => {
        const current = catalogue.find(row => row.id === item.productId);
        const priceOverride = item.priceOverride === null || item.priceOverride === ''
          ? null : Number(item.priceOverride);
        return {
          ...current,
          priceOverride,
          storePrice: priceOverride === null ? current.centralPrice : priceOverride,
          isAvailable: item.isAvailable
        };
      });
      return send({ ok: true, items: savedItems });
    }

    return send({ error: 'Unexpected Owner E2E endpoint: ' + method + ' ' + path }, 404);
  });

  // Open the existing Stores route directly. The desktop "More" menu is
  // intentionally hidden at this mobile viewport; route bootstrap still loads
  // the same authenticated Store Management screen.
  await page.goto('/admin.html#stores');
  await expect(page.locator('#loginView')).toBeVisible();
  await page.locator('#adminToken').fill('owner-e2e-token');
  await page.locator('#connectBtn').click();
  await expect(page.locator('#authState')).toHaveText('Connected');
  await expect(page.locator('#storeManagement')).toContainText('Kukatpally Store');
  await page.locator('[data-edit-catalogue="store-1"]').click();

  const panel = page.locator('.fw-store-catalogue-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Central ₹220');
  await expect(panel).toContainText('Central ₹150');

  await page.locator('[data-catalogue-price="oil-1"]').fill('189');
  await page.locator('[data-catalogue-available="rice-1"]').uncheck();
  await page.locator('[data-catalogue-price="rice-1"]').fill('');
  await page.locator('[data-catalogue-price="oil-2"]').fill('');

  await page.locator('[data-save-catalogue]').click();
  await expect(page.locator('#storeManagement')).toContainText('Store product availability and prices saved.');

  const saveCall = apiCalls.find(call =>
    call.method === 'PATCH' && call.path === '/api/admin/delivery/stores/store-1/catalogue'
  );
  expect(saveCall).toBeTruthy();
  expect(saveCall.body.items).toEqual([
    { productId: 'oil-1', isAvailable: true, priceOverride: '189' },
    { productId: 'rice-1', isAvailable: false, priceOverride: null },
    { productId: 'oil-2', isAvailable: true, priceOverride: null }
  ]);
  expect(apiCalls.filter(call => call.path.includes('/inventory') && call.method !== 'GET')).toEqual([]);
  expect(apiCalls.filter(call => call.type === 'pageerror')).toEqual([]);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
