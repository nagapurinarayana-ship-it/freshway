import { test, expect } from '@playwright/test';

let savedAddresses = [];

const products = [{
  id: 'p1',
  name: 'Basmati Rice',
  unit: 'kg',
  price: 120,
  emoji: '🍚',
  active: 1,
  category_id: 'cat-rice',
  category_name: 'Rice',
  category_slug: 'rice'
}];

test.beforeEach(async ({ page }) => {
  savedAddresses = [];
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Keep this E2E deterministic without depending on browser/device GPS permissions.
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 17.385044, longitude: 78.486671, accuracy: 10 }, timestamp: Date.now() });
        }
      }
    });
  });

  await page.route('https://nominatim.openstreetmap.org/reverse?**', async route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        place_id: 1,
        display_name: '12, Test Street, Boduppal, Hyderabad, Telangana, 500001',
        address: {
          house_number: '12',
          road: 'Test Street',
          suburb: 'Boduppal',
          city: 'Hyderabad',
          district: 'Medchal',
          state: 'Telangana',
          postcode: '500001'
        }
      })
    });
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/categories' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          categories: [{
            id: 'cat-rice',
            name: 'Rice',
            slug: 'rice',
            icon: '🍚',
            description: 'Rice and rice varieties',
            product_count: 1,
            display_order: 1
          }]
        })
      });
    }

    if (url.pathname === '/api/products' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ products })
      });
    }

    if (url.pathname === '/api/addresses' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ addresses: savedAddresses })
      });
    }

    if (url.pathname === '/api/addresses' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const address = {
        ...payload,
        id: savedAddresses.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
        isDefault: savedAddresses.length === 0 || !!payload.isDefault
      };
      if (address.isDefault) savedAddresses = savedAddresses.map(item => ({ ...item, isDefault: false }));
      savedAddresses.push(address);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: address.id, addresses: savedAddresses })
      });
    }

    if (url.pathname.startsWith('/api/addresses/') && url.pathname.split('/').filter(Boolean).length === 3 && method === 'PATCH') {
      const id = Number(url.pathname.split('/').pop());
      const payload = JSON.parse(request.postData() || '{}');
      if (payload.default === true) {
        savedAddresses = savedAddresses.map(item => ({ ...item, isDefault: Number(item.id) === id }));
      } else {
        savedAddresses = savedAddresses.map(item => Number(item.id) === id ? { ...item, ...payload } : item);
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, addresses: savedAddresses })
      });
    }

    if (url.pathname.startsWith('/api/addresses/') && url.pathname.endsWith('/delete') && method === 'POST') {
      const id = Number(url.pathname.split('/')[3]);
      savedAddresses = savedAddresses.filter(item => Number(item.id) !== id);
      if (savedAddresses.length && !savedAddresses.some(item => item.isDefault)) savedAddresses[0].isDefault = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, addresses: savedAddresses })
      });
    }

    if (url.pathname.startsWith('/api/addresses/') && url.pathname.split('/').filter(Boolean).length === 3 && method === 'DELETE') {
      const id = Number(url.pathname.split('/').pop());
      savedAddresses = savedAddresses.filter(item => Number(item.id) !== id);
      if (savedAddresses.length && !savedAddresses.some(item => item.isDefault)) savedAddresses[0].isDefault = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, addresses: savedAddresses })
      });
    }

    if (url.pathname === '/api/auth/session' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ customerId: 'e2e-customer-1' })
      });
    }

    if (url.pathname === '/api/orders' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'FW-E2E-0001',
          customerId: payload.customerId,
          total: 120,
          payment: 'Not Collected',
          status: 'New',
          deliveryPlan: 'Tomorrow',
          createdAt: '2026-10-07T10:00:00.000Z',
          updatedAt: '2026-10-07T10:00:00.000Z',
          address: payload.address,
          items: [{
            id: 'p1',
            name: 'Basmati Rice',
            unit: 'kg',
            qty: 1,
            price: 120,
            lineTotal: 120
          }]
        })
      });
    }

    if (url.pathname === '/api/orders' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [] })
      });
    }

    if (url.pathname === '/api/customers/register' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    }

    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    }

    if (url.pathname === '/api/push/public-key' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ publicKey: null })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'E2E mock endpoint not defined.' })
    });
  });
});

test('customer can browse, add a product, checkout, and receive confirmation', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#productGrid .product-card')).toContainText('Basmati Rice');
  await expect(page.locator('[data-fw-category="cat-rice"]')).toContainText('Rice');

  await page.locator('[data-fw-category="cat-rice"]').click();
  await expect(page.locator('#productGrid')).toBeVisible();
  await expect(page.locator('#productGrid .product-card')).toContainText('Basmati Rice');

  await page.locator('#productGrid .add-btn').click();
  await expect(page.locator('#cartCount')).toHaveText('1 item');
  await expect(page.locator('#cartTotal')).toHaveText('₹120');

  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#checkoutBtn')).toBeVisible();
  await page.locator('#checkoutBtn').click();

  // New customers manage their first address from the dedicated address
  // editor; the checkout fields are not exposed as a second address form.
  await expect(page.locator('#fwCheckoutAddAddress')).toBeVisible();
  await page.locator('#fwCheckoutAddAddress').click();
  await expect(page.locator('#fwAddressManagerNew')).toBeVisible();
  await page.locator('#fwAddressManagerNew').click();
  await expect(page.locator('#fwAddrName')).toBeVisible();
  await page.locator('#fwAddrName').fill('E2E Customer');
  await page.locator('#fwAddrPhone').fill('9876543210');
  await page.locator('#fwAddrHouse').fill('12');
  await page.locator('#fwAddrArea').fill('Test Street');
  await page.locator('#fwAddrCity').fill('Hyderabad');
  await page.locator('#fwAddrPincode').fill('500001');
  await page.locator('#fwAddressGps').click();
  await expect(page.locator('#fwAddressLocationStatus')).toContainText('Delivery pin selected');
  await page.locator('#fwAddressSave').click();
  await expect(page.locator('.fw-address-card')).toContainText('Default');
  await page.locator('.fw-address-card [data-fw-use]').click();
  await expect(page.locator('#fwCheckoutAddressSummary')).toContainText('E2E Customer');

  await page.locator('#checkoutForm button[type="submit"]').click();

  await expect(page.locator('#confirmationView')).toBeVisible();
  await expect(page.locator('#confirmationView')).toContainText('FW-E2E-0001');
  await expect(page.locator('#confirmationView')).toContainText('Payment: Cash');
  await expect(page.locator('#confirmationView')).toContainText('Delivery plan: Tomorrow');
  await expect(page.locator('#cartCount')).toHaveText('0 items');
});

test('customer shell exposes the direct-install PWA contract', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/FreshWay/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f7a4b');
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('#main-content')).toBeVisible();
});
