import { test, expect } from '@playwright/test';

const origin = 'http://localhost:4173';
const workerOrigin = 'http://localhost:8787';

async function proxyOwnerAssets(page) {
  await page.route(url => url.pathname.startsWith('/admin/'), async route => {
    const incoming = new URL(route.request().url());
    let targetPath = incoming.pathname;
    if (targetPath !== '/admin/sw.js' && targetPath !== '/admin/manifest.webmanifest' && !targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.replace(/^\/admin(?=\/)/, '');
    } else if (targetPath.startsWith('/admin/icons/')) {
      targetPath = targetPath.replace(/^\/admin\/icons\//, '/icons/');
    }
    const response = await route.fetch({ url: origin + targetPath + incoming.search });
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

test('Owner order status, payment and cash screens work through the real UI', async ({ browser }) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  let captureFailures = false;
  let orderId = '';
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', async response => {
    if (!captureFailures || response.status() < 400) return;
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) apiFailures.push({ status: response.status(), path: url.pathname });
  });

  try {
    const phone = '9' + String(Date.now()).slice(-9);
    const passcode = String(100000 + (Date.now() % 900000));
    const registration = await context.request.post(workerOrigin + '/api/auth/register', {
      headers: { Origin: origin },
      data: { name: 'Owner Lifecycle UI E2E', phone, passcode }
    });
    expect(registration.status()).toBe(200);
    const customer = await registration.json();
    const session = (registration.headers()['set-cookie'] || '').match(/freshway-customer-session=([^;,\s]+)/);
    expect(customer.customerId).toBeTruthy();
    expect(session).toBeTruthy();
    await context.addCookies([{
      name: 'freshway-customer-session', value: session[1], url: workerOrigin,
      secure: true, httpOnly: true, sameSite: 'None'
    }]);

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const [year, month, day] = today.split('-').map(Number);
    const deliveryDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    const created = await context.request.post(workerOrigin + '/api/orders', {
      headers: { Origin: origin },
      data: {
        customerId: customer.customerId,
        customer: { name: 'Owner Lifecycle UI E2E', phone },
        address: { recipientName: 'Owner Lifecycle UI E2E', house: '12', area: 'Owner Workflow Test Colony', city: 'Hyderabad', pincode: '500072', latitude: 17.385044, longitude: 78.486671, deliveryPhone: phone },
        storeId: 'store-d1', preferredDeliveryDate: deliveryDate, items: [{ id: 'oil-d1', qty: 1 }]
      }
    });
    expect(created.status()).toBe(201);
    const createdOrder = await created.json();
    orderId = createdOrder.id;
    expect(createdOrder.assignedStoreId).toBe('store-d1');

    await proxyOwnerAssets(page);
    await proxyWorkerApi(page);
    const home = await page.goto('/admin.html#orders');
    expect(home?.status()).toBe(200);
    await expect(page.locator('#loginView')).toBeVisible();
    const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/login' && response.request().method() === 'POST');
    await page.locator('#adminToken').fill(['isolated', 'admin', 'token'].join('-'));
    await page.locator('#connectBtn').click();
    expect((await login).status()).toBe(200);
    await expect(page.locator('#appView')).toBeVisible();
    await expect(page.locator('#orders')).toHaveClass(/active/);
    await page.waitForLoadState('networkidle');
    captureFailures = true;

    await page.locator('#orderSearch').fill(orderId);
    const card = page.locator('#ordersList .order-card[data-order="' + orderId + '"]');
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.click();
    await expect(page.locator('#fwLifeStatus')).toHaveValue('New');
    await expect(page.locator('#fwLifePayment')).toHaveValue('Not Collected');

    const saveField = async (selector, value) => {
      const result = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/admin/orders/' + encodeURIComponent(orderId) && response.request().method() === 'PATCH';
      });
      await page.locator(selector).selectOption(value);
      expect((await result).status()).toBe(200);
      await expect(page.locator('#fwLifeSave')).toContainText('Saved', { timeout: 20000 });
    };
    const readOrder = async () => page.evaluate(async id => {
      const response = await fetch('/api/admin/orders?search=' + encodeURIComponent(id) + '&limit=1&testOrders=0', { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      return { status: response.status, order: (data.orders || []).find(item => item.id === id) || null };
    }, orderId);

    await saveField('#fwLifeStatus', 'Confirmed');
    expect((await readOrder()).order.status).toBe('Confirmed');
    await saveField('#fwLifePayment', 'Collected');
    let saved = await readOrder();
    expect(saved.order.payment).toBe('Collected');
    expect(saved.order.paymentCollectedAt).toBeTruthy();
    await saveField('#fwLifeStatus', 'Processing');
    expect((await readOrder()).order.status).toBe('Processing');
    await saveField('#fwLifeStatus', 'Ready');
    expect((await readOrder()).order.status).toBe('Ready');

    await page.locator('#modalClose').click();
    await page.evaluate(() => window.navigateAdminScreen('cash'));
    await expect(page.locator('#cash')).toHaveClass(/active/);
    await expect(page.locator('#cashSummary')).toBeVisible();
    await expect(page.locator('#cashList .order-card[data-order="' + orderId + '"]')).toHaveCount(0);

    await page.evaluate(() => window.navigateAdminScreen('orders'));
    const refreshedCard = page.locator('#ordersList .order-card[data-order="' + orderId + '"]');
    await expect(refreshedCard).toBeVisible({ timeout: 20000 });
    await refreshedCard.click();
    await expect(page.locator('#fwLifeStatus')).toHaveValue('Ready');
    await expect(page.locator('#fwLifePayment')).toHaveValue('Collected');
    await saveField('#fwLifePayment', 'Refunded');
    saved = await readOrder();
    expect(saved.order).toMatchObject({ status: 'Ready', payment: 'Refunded', paymentCollectedAt: null });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => {
      const bounds = selector => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, width: rect.width } : null;
      };
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, status: bounds('#fwLifeStatus'), payment: bounds('#fwLifePayment') };
    });
    expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.width + 1);
    expect(mobile.status).toBeTruthy();
    expect(mobile.payment).toBeTruthy();
    expect(mobile.status.left).toBeGreaterThanOrEqual(0);
    expect(mobile.payment.left).toBeGreaterThanOrEqual(0);
    expect(mobile.status.right).toBeLessThanOrEqual(mobile.width + 1);
    expect(mobile.payment.right).toBeLessThanOrEqual(mobile.width + 1);

    await saveField('#fwLifeStatus', 'Cancelled');
    saved = await readOrder();
    expect(saved.order).toMatchObject({ status: 'Cancelled', payment: 'Refunded' });
    const stock = await page.evaluate(async () => {
      const response = await fetch('/api/admin/delivery/stores/store-d1/inventory', { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      const oil = (data.inventory || []).find(item => item.id === 'oil-d1');
      return { status: response.status, onHand: Number(oil?.on_hand), reserved: Number(oil?.reserved_qty) };
    });
    expect(stock).toEqual({ status: 200, onHand: 10, reserved: 0 });
    await page.locator('#modalClose').click();
    await page.evaluate(() => window.navigateAdminScreen('cash'));
    await expect(page.locator('#cashList .order-card[data-order="' + orderId + '"]')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(apiFailures).toEqual([]);
  } finally {
    if (orderId) {
      await page.evaluate(async id => {
        try {
          await fetch('/api/admin/orders/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment: 'Refunded' }) });
          await fetch('/api/admin/orders/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Cancelled' }) });
        } catch (_) {}
      }, orderId).catch(() => {});
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});