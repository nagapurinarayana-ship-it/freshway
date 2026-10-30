import { test, expect } from '@playwright/test';

const PREVIEW_BASE_URL = String(process.env.FRESHWAY_PREVIEW_BASE_URL || '').replace(/\/$/, '');
const PREVIEW_ORIGIN = PREVIEW_BASE_URL ? new URL(PREVIEW_BASE_URL).origin : '';

test.skip(!PREVIEW_BASE_URL, 'Set FRESHWAY_PREVIEW_BASE_URL to the isolated FreshWay Pages Preview before running real-D1 E2E tests.');

function tomorrowInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const date = {};
  for (const part of parts) date[part.type] = part.value;
  const value = new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day) + 1));
  return value.getUTCFullYear() + '-' +
    String(value.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(value.getUTCDate()).padStart(2, '0');
}

async function expectJson(response, expectedStatus = 200) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error(`Expected JSON from ${response.url()}, received HTTP ${response.status()}: ${text.slice(0, 300)}`); }
  expect(response.status(), JSON.stringify(data)).toBe(expectedStatus);
  return data;
}

test('real Preview D1: customer checkout → Owner lifecycle → customer order refresh → catalogue CRUD', async ({ page }) => {
  test.setTimeout(240000);

  expect(new URL(PREVIEW_BASE_URL).protocol).toBe('https:');
  expect(new URL(PREVIEW_BASE_URL).hostname).toBe('test-expand-playwright-cover.freshway-f32.pages.dev');

  const originHeaders = { Origin: PREVIEW_ORIGIN };
  const runId = `e2e-${Date.now().toString(36)}`;
  const randomDigits = String(Date.now()).slice(-9).padStart(9, '0');
  const phone = '9' + randomDigits;
  const customerName = 'FW Preview QA ' + runId;
  const passcode = String(100000 + Math.floor(Math.random() * 900000));
  const categorySlug = 'fw-preview-e2e-' + runId;
  const crudSlug = 'fw-preview-e2e-crud-' + runId;
  let categoryId = '';
  let productId = '';
  let crudCategoryId = '';
  let crudProductId = '';
  let addressId = '';
  let orderId = '';
  const apiFailures = [];
  const jsErrors = [];
  const assetFailures = [];

  page.on('pageerror', error => jsErrors.push(error.message));
  page.on('response', response => {
    const request = response.request();
    const url = new URL(response.url());
    if (url.origin === PREVIEW_ORIGIN && url.pathname.startsWith('/api/') && response.status() >= 400) {
      apiFailures.push({ method: request.method(), path: url.pathname, status: response.status() });
    }
    if (url.origin === PREVIEW_ORIGIN && ['script', 'stylesheet', 'image'].includes(request.resourceType()) && response.status() >= 400) {
      assetFailures.push({ path: url.pathname, status: response.status(), type: request.resourceType() });
    }
  });

  const apiGet = async path => page.request.get(PREVIEW_BASE_URL + path, { headers: originHeaders });
  const apiPost = async (path, data) => page.request.post(PREVIEW_BASE_URL + path, { headers: originHeaders, data });
  const apiPatch = async (path, data) => page.request.patch(PREVIEW_BASE_URL + path, { headers: originHeaders, data });
  const apiDelete = async path => page.request.delete(PREVIEW_BASE_URL + path, { headers: originHeaders });

  try {
    // The Admin status, Preview binding, and D1-backed catalogue must be real responses.
    const adminStatus = await expectJson(await apiGet('/api/admin/status'));
    expect(adminStatus.ok).toBe(true);

    // Create a temporary active category and product in the isolated D1.
    const createdCategory = await expectJson(await apiPost('/api/admin/categories', {
      name: customerName + ' oils',
      slug: categorySlug,
      icon: '🫒',
      description: 'Temporary real-D1 end-to-end test category',
      displayOrder: 900,
      active: true
    }), 201);
    categoryId = createdCategory.category.id;
    expect(categoryId).toBeTruthy();

    const createdProduct = await expectJson(await apiPost('/api/admin/catalogue/products', {
      name: 'QA Groundnut Oil ' + runId,
      unit: 'kg',
      price: 137,
      emoji: '🫒',
      categoryId,
      displayOrder: 1,
      stockManaged: false,
      stockQuantity: 0,
      lowStockThreshold: 0
    }), 201);
    productId = createdProduct.product.id;
    expect(productId).toBeTruthy();

    const publicCategories = await expectJson(await apiGet('/api/categories'));
    const publicProducts = await expectJson(await apiGet('/api/products'));
    expect(publicCategories.categories.some(item => item.id === categoryId)).toBe(true);
    expect(publicProducts.products.some(item => item.id === productId && Number(item.price) === 137)).toBe(true);

    const adminCatalogue = await expectJson(await apiGet('/api/admin/catalogue'));
    expect(adminCatalogue.categories.some(item => item.id === categoryId)).toBe(true);
    expect(adminCatalogue.products.some(item => item.id === productId)).toBe(true);

    // Exercise category update and product create/update/delete using disposable D1 rows.
    const crudCategory = await expectJson(await apiPost('/api/admin/categories', {
      name: customerName + ' disposable',
      slug: crudSlug,
      icon: '🧪',
      description: 'Disposable CRUD verification category',
      displayOrder: 901,
      active: false
    }), 201);
    crudCategoryId = crudCategory.category.id;

    const crudProduct = await expectJson(await apiPost('/api/admin/catalogue/products', {
      name: 'Disposable QA product ' + runId,
      unit: 'piece',
      price: 29,
      emoji: '🧪',
      categoryId: crudCategoryId,
      displayOrder: 1,
      stockManaged: false,
      stockQuantity: 0,
      lowStockThreshold: 0
    }), 201);
    crudProductId = crudProduct.product.id;

    await expectJson(await apiPatch('/api/admin/categories/' + encodeURIComponent(crudCategoryId), {
      name: customerName + ' disposable updated',
      description: 'Updated by the real-Preview CRUD test'
    }));
    await expectJson(await apiPatch('/api/admin/catalogue/products/' + encodeURIComponent(crudProductId), {
      name: 'Disposable QA product updated ' + runId,
      price: 31
    }));
    const updatedCatalogue = await expectJson(await apiGet('/api/admin/catalogue'));
    expect(updatedCatalogue.categories.find(item => item.id === crudCategoryId)?.name).toContain('updated');
    expect(Number(updatedCatalogue.products.find(item => item.id === crudProductId)?.price)).toBe(31);

    // Register a real synthetic customer in Preview D1 and verify a signed session.
    const registered = await expectJson(await apiPost('/api/auth/register', {
      name: customerName,
      phone,
      passcode,
      whatsappOptIn: false
    }), 200);
    expect(registered.ok).toBe(true);
    expect(registered.customerId).toBeTruthy();

    const session = await expectJson(await apiGet('/api/auth/session'));
    expect(session.customerId).toBe(registered.customerId);

    const savedAddress = await expectJson(await apiPost('/api/addresses', {
      label: 'Home',
      recipientName: customerName,
      deliveryPhone: phone,
      house: 'QA House 1',
      area: 'Preview Test Street',
      city: 'Hyderabad',
      state: 'Telangana',
      district: 'Hyderabad',
      pincode: '500001',
      landmark: 'Preview QA',
      note: 'Automated isolated Preview order test',
      isDefault: true
    }), 201);
    addressId = savedAddress.id;
    expect(addressId).toBeTruthy();

    // Use the real customer storefront and real D1-backed catalogue/cart/quote/checkout APIs.
    await page.goto(PREVIEW_BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('#productGrid .product-card')).toContainText('QA Groundnut Oil ' + runId, { timeout: 30000 });
    await page.locator('#productGrid .product-card').filter({ hasText: 'QA Groundnut Oil ' + runId }).locator('.add-btn').click();
    await expect(page.locator('#cartCount')).toContainText('1');
    await expect(page.locator('#cartTotal')).toContainText('₹137');

    await page.locator('#viewCartBtn').click();
    await expect(page.locator('#checkoutBtn')).toBeVisible();
    await page.locator('#checkoutBtn').click();
    await expect(page.locator('#checkoutForm')).toBeVisible();

    await page.locator('#customerName').fill(customerName);
    await page.locator('#customerPhone').fill(phone);
    await page.locator('#house').fill('QA House 1');
    await page.locator('#area').fill('Preview Test Street');
    await page.locator('#city').fill('Hyderabad');
    await page.locator('#pincode').fill('500001');
    await page.locator('#checkoutDeliveryPicker [data-fw-date-choice="tomorrow"]').click();

    await expect(page.locator('#checkoutDeliveryPicker .fw-delivery-date-summary')).toContainText('Delivery date:');
    await expect.poll(async () => {
      return page.locator('#checkoutForm button[type="submit"]').isEnabled();
    }, { timeout: 30000 }).toBe(true);

    const createOrderResponse = page.waitForResponse(response =>
      new URL(response.url()).origin === PREVIEW_ORIGIN &&
      new URL(response.url()).pathname === '/api/orders' &&
      response.request().method() === 'POST'
    );
    await page.locator('#checkoutForm button[type="submit"]').click();
    const createdOrderResponse = await createOrderResponse;
    const order = await expectJson(createdOrderResponse, 201);
    orderId = order.id;
    expect(orderId).toBeTruthy();
    expect(order.isTestOrder).toBe(true);
    expect(order.status).toBe('New');
    expect(Number(order.total)).toBeGreaterThanOrEqual(137);

    await expect(page.locator('#confirmationView')).toBeVisible();
    await expect(page.locator('#confirmationView')).toContainText(orderId);

    // Confirm the new record is visible to the customer's authenticated order endpoint.
    const customerOrders = await expectJson(await apiGet('/api/orders?customerId=' + encodeURIComponent(registered.customerId)));
    let customerOrder = customerOrders.orders.find(item => item.id === orderId);
    expect(customerOrder).toBeTruthy();
    expect(customerOrder.isTestOrder).toBe(true);
    expect(customerOrder.status).toBe('New');

    // Open Owner Preview directly on Home, then locate the same D1 order in Test orders.
    await page.goto(PREVIEW_BASE_URL + '/admin/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('#loginView')).toHaveClass(/hidden/);
    await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
    await expect(page.locator('#authState')).toContainText('Preview · test data');

    await page.locator('.side [data-screen="orders"]').click();
    await page.locator('#testOrdersTab').click();
    await page.locator('#orderSearch').fill(orderId);
    const orderCard = page.locator('#ordersList [data-order="' + orderId + '"]');
    await expect(orderCard).toBeVisible({ timeout: 30000 });
    await orderCard.click();
    await expect(page.locator('#fwLifeStatus')).toBeVisible();

    // Owner lifecycle and payment updates must be committed to D1 and reappear in Customer orders.
    for (const status of ['Confirmed', 'Processing', 'Ready', 'Out for Delivery', 'Delivered']) {
      const patch = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/admin/orders/' + encodeURIComponent(orderId) &&
        response.request().method() === 'PATCH'
      );
      await page.locator('#fwLifeStatus').selectOption(status);
      const savedResponse = await patch;
      await expectJson(savedResponse, 200);
      await expect(page.locator('#fwLifeSave')).toContainText('Saved', { timeout: 30000 });

      const refreshed = await expectJson(await apiGet('/api/orders?customerId=' + encodeURIComponent(registered.customerId)));
      customerOrder = refreshed.orders.find(item => item.id === orderId);
      expect(customerOrder?.status).toBe(status);
    }

    const paymentPatch = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/admin/orders/' + encodeURIComponent(orderId) &&
      response.request().method() === 'PATCH'
    );
    await page.locator('#fwLifePayment').selectOption('Collected');
    await expectJson(await paymentPatch, 200);
    await expect(page.locator('#fwLifeSave')).toContainText('Saved', { timeout: 30000 });

    const finalCustomerOrders = await expectJson(await apiGet('/api/orders?customerId=' + encodeURIComponent(registered.customerId)));
    customerOrder = finalCustomerOrders.orders.find(item => item.id === orderId);
    expect(customerOrder.status).toBe('Delivered');
    expect(customerOrder.payment).toBe('Collected');
    expect(customerOrder.deliveredAt).toBeTruthy();

    // Exercise real Owner reads across all existing operational sections.
    const screens = [
      ['delivery', '#delivery'],
      ['customers', '#customers'],
      ['catalogue', '#catalogue'],
      ['cash', '#cash'],
      ['offers', '#offers'],
      ['notifications', '#notifications'],
      ['reports', '#reports'],
      ['settings', '#settings'],
      ['stores', '#stores'],
      ['messages', '#messages'],
      ['requests', '#requests']
    ];
    for (const [screen, selector] of screens) {
      if (screen === 'catalogue' || screen === 'offers' || screen === 'notifications' ||
          screen === 'reports' || screen === 'settings' || screen === 'stores' ||
          screen === 'messages' || screen === 'requests') {
        await page.locator('.owner-nav-more > summary').click();
      }
      await page.locator('[data-screen="' + screen + '"]').click();
      await expect(page.locator(selector)).toHaveClass(/active/, { timeout: 15000 });
    }

    // Delete the disposable product and category, then soft-delete the test customer's saved address.
    await expectJson(await apiDelete('/api/admin/catalogue/products/' + encodeURIComponent(crudProductId)));
    crudProductId = '';
    await expectJson(await apiDelete('/api/admin/categories/' + encodeURIComponent(crudCategoryId)));
    crudCategoryId = '';
    await expectJson(await apiDelete('/api/addresses/' + encodeURIComponent(addressId)));
    addressId = '';
    // Keep the order's referenced product as inactive catalogue history, not a live sellable item.
    await expectJson(await apiPatch('/api/admin/catalogue/products/' + encodeURIComponent(productId), { active: false }));
    productId = '';

    expect(apiFailures, 'Preview APIs must not return unexpected 4xx/5xx responses').toEqual([]);
    expect(assetFailures, 'Preview scripts, styles, and images must load').toEqual([]);
    expect(jsErrors, 'Customer and Owner screens must not throw browser exceptions').toEqual([]);
  } finally {
    // Best-effort cleanup only for disposable records created by this test.
    if (crudProductId) await apiDelete('/api/admin/catalogue/products/' + encodeURIComponent(crudProductId)).catch(() => {});
    if (crudCategoryId) await apiDelete('/api/admin/categories/' + encodeURIComponent(crudCategoryId)).catch(() => {});
    if (addressId) await apiDelete('/api/addresses/' + encodeURIComponent(addressId)).catch(() => {});
    if (productId) await apiPatch('/api/admin/catalogue/products/' + encodeURIComponent(productId), { active: false }).catch(() => {});
  }
});
