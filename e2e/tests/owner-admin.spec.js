import { test, expect } from '@playwright/test';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZkAAAAASUVORK5CYII=';

async function installReadOnlyOwnerApi(page) {
  const writes = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const path = url.pathname;

    if (method !== 'GET') {
      writes.push({ method, path });
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Mutation blocked by read-only Owner browser test.' })
      });
      return;
    }

    let data = {};
    if (path === '/api/admin/summary') {
      data = { newOrders: 0, processing: 0, deliveryToday: 0, cashPending: 0 };
    } else if (path === '/api/admin/reports') {
      data = {
        sales: 0, orders: 0, cashPending: 0, cashPendingOrders: 0,
        delivered: 0, deliveredSales: 0, customers: 0, newCustomers: 0,
        aov: 0, eligibleOrders: 0, cashCollected: 0, cashCollectedOrders: 0,
        cancelled: 0, cancelledValue: 0, repeatOrders: 0,
        topProducts: [], topCustomers: []
      };
    } else if (path === '/api/admin/orders') {
      data = { orders: [], pagination: { total: 0, page: 1, limit: 50 } };
    } else if (path === '/api/admin/customers') {
      data = { customers: [], pagination: { total: 0, page: 1, limit: 25 } };
    } else if (path === '/api/admin/products') {
      data = { products: [] };
    } else if (path === '/api/admin/catalogue') {
      data = {
        categories: [{
          id: 'qa-category-oils',
          name: 'Browser QA Oils',
          slug: 'browser-qa-oils',
          icon: '🫒',
          description: 'Read-only browser fixture',
          active: 1,
          active_product_count: 1,
          hidden_product_count: 0,
          display_order: 1
        }],
        products: [{
          id: 'qa-product-groundnut',
          category_id: 'qa-category-oils',
          name: 'QA Groundnut Oil',
          price: 1850,
          unit: '5 ltr',
          emoji: '🫒',
          active: 1,
          stock_managed: 0,
          stock_quantity: 0,
          low_stock_threshold: 5,
          display_order: 1
        }]
      };
    } else if (path === '/api/admin/promotions') {
      data = {
        promotions: [{
          id: 'qa-promotion-1',
          alt_text: 'Browser QA banner showing a groundnut oil offer',
          image_data: tinyPng,
          image_mime_type: 'image/png',
          display_order: 1,
          active: 1
        }]
      };
    } else if (path === '/api/admin/delivery') {
      data = { orders: [] };
    } else if (path === '/api/admin/customer-messages') {
      data = { messages: [], summary: { total: 0, pending: 0, replied: 0 } };
    } else if (path === '/api/admin/delivery-offers') {
      data = { settings: {}, coupons: [] };
    } else if (path === '/api/admin/notifications/history') {
      data = { notifications: [] };
    } else if (path === '/api/store-profile') {
      data = { profile: {} };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data)
    });
  });
  return writes;
}

test('Owner sign-in stays locked without a session and does not call admin APIs for an empty token', async ({ page }) => {
  const writes = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push({ method: request.method(), url: request.url() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.goto('/admin.html');
  await expect(page.locator('#loginView')).toBeVisible();
  await expect(page.locator('#adminToken')).toBeVisible();
  await expect(page.locator('#appView')).toHaveClass(/hidden/);

  await page.locator('#connectBtn').click();
  await expect(page.locator('#toast')).toContainText('Enter the Worker ADMIN_TOKEN');
  expect(writes).toEqual([]);
});

test('Owner can browse orders and catalogue screens using read-only API fixtures', async ({ page }) => {
  const writes = await installReadOnlyOwnerApi(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('freshway-admin-auth', '1'));

  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto('/admin.html');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  await expect(page.locator('#overview h1')).toContainText('Good day');

  await page.locator('.side [data-screen="orders"]').click();
  await expect(page.locator('#orders')).toHaveClass(/active/);
  await expect(page.locator('#ordersList')).toContainText('No orders match');

  await page.locator('.owner-nav-more > summary').click();
  await page.locator('.owner-nav-more [data-screen="catalogue"]').click();
  await expect(page.locator('#catalogue')).toHaveClass(/active/);
  await expect(page.locator('#fwPromotionsArea .fw-promo-card')).toHaveCount(1);
  await expect(page.locator('.fw-promo-alt')).toContainText('Browser QA banner showing a groundnut oil offer');
  await expect(page.locator('#fwCategoryList')).toContainText('Browser QA Oils');

  await page.locator('[data-fw-manage="qa-category-oils"]').click();
  await expect(page.locator('#fwProductsArea .fw-product')).toContainText('QA Groundnut Oil');
  await expect(page.locator('#fwProductsArea .fw-product')).toContainText('₹1,850');

  await page.locator('[data-fw-edit-promo="qa-promotion-1"]').click();
  await expect(page.locator('#fwPromotionForm')).toBeVisible();
  await expect(page.locator('#fwPromoAlt')).toHaveValue('Browser QA banner showing a groundnut oil offer');

  expect(writes, 'Owner browser coverage must not write to any API').toEqual([]);
  expect(pageErrors, 'Owner screens should not throw uncaught browser errors').toEqual([]);
});


test('Owner can move a synthetic order through processing and dispatch statuses', async ({ page }) => {
  const writes = [];
  let order = {
    id: 'FW-QA-ORDER-1',
    status: 'New',
    payment: 'Not Collected',
    deliveryPlan: 'Tomorrow',
    total: 200,
    createdAt: '2026-10-30T08:00:00.000Z',
    customer: { name: 'Browser QA Customer', phone: '9876543210' },
    address: {
      recipientName: 'Browser QA Customer',
      deliveryPhone: '9876543210',
      house: '1-1',
      area: 'Test Road',
      city: 'Test City',
      pincode: '500001'
    },
    items: [{ name: 'QA Rice', unit: 'kg', qty: 2, lineTotal: 200 }],
    scheduledDelivery: { date: '2099-01-01' },
    isTestOrder: false
  };

  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const path = url.pathname;

    if (method === 'PATCH' && path === '/api/admin/orders/FW-QA-ORDER-1') {
      const body = request.postDataJSON();
      writes.push({ method, path, body });
      order = { ...order, ...body };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: order.status, payment: order.payment, isTestOrder: order.isTestOrder ? 1 : 0 })
      });
      return;
    }

    if (method !== 'GET') {
      writes.push({ method, path });
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unexpected mutation in synthetic Owner test.' })
      });
      return;
    }

    let data = {};
    if (path === '/api/admin/summary') {
      data = { newOrders: 1, processing: 0, deliveryToday: 0, cashPending: 200 };
    } else if (path === '/api/admin/reports') {
      data = {
        sales: 200, orders: 1, cashPending: 200, cashPendingOrders: 1,
        delivered: 0, deliveredSales: 0, customers: 1, newCustomers: 1,
        aov: 200, eligibleOrders: 1, cashCollected: 0, cashCollectedOrders: 0,
        cancelled: 0, cancelledValue: 0, repeatOrders: 0,
        topProducts: [], topCustomers: []
      };
    } else if (path === '/api/admin/orders') {
      data = { orders: [{ ...order }], pagination: { total: 1, page: 1, limit: 50 } };
    } else if (path === '/api/admin/customers') {
      data = { customers: [], pagination: { total: 0, page: 1, limit: 25 } };
    } else if (path === '/api/admin/products') {
      data = { products: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data)
    });
  });

  await page.addInitScript(() => localStorage.setItem('freshway-admin-auth', '1'));
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto('/admin.html');
  await page.locator('.side [data-screen="orders"]').click();
  await expect(page.locator('#ordersList [data-order="FW-QA-ORDER-1"]')).toBeVisible();

  await page.locator('#ordersList [data-order="FW-QA-ORDER-1"]').click();
  await expect(page.locator('#fwLifeStatus')).toBeVisible();

  for (const status of ['Confirmed', 'Processing', 'Ready', 'Out for Delivery']) {
    const patchResponse = page.waitForResponse(response =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/api/admin/orders/FW-QA-ORDER-1')
    );
    await page.locator('#fwLifeStatus').selectOption(status);
    const response = await patchResponse;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status });
    await expect(page.locator('#fwLifeStatus')).toHaveValue(status);
    await expect(page.locator('#fwLifeSave')).toHaveText('Saved');
  }

  expect(order.status).toBe('Out for Delivery');
  expect(writes.map(item => item.body?.status)).toEqual(['Confirmed', 'Processing', 'Ready', 'Out for Delivery']);
  expect(writes.every(item => item.method === 'PATCH' && item.path === '/api/admin/orders/FW-QA-ORDER-1')).toBe(true);
});

test('Owner shell loads install and order-alert assets without 404 responses', async ({ page }) => {
  const expectedAssets = [
    '/owner-pwa-install.css',
    '/owner-pwa-install.js',
    '/frontend/admin/order-alerts.js'
  ];
  const responses = new Map();

  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (expectedAssets.includes(pathname)) responses.set(pathname, response.status());
  });

  await page.goto('/admin.html', { waitUntil: 'load' });
  await expect.poll(() => responses.size, {
    message: 'All Owner install and order-alert assets should be requested',
    timeout: 10000
  }).toBe(expectedAssets.length);

  for (const asset of expectedAssets) {
    expect(responses.get(asset), asset + ' must be served successfully').toBe(200);
  }
});
