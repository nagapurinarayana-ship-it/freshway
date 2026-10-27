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

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/api/geocode/reverse' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          place_id: 98765,
          display_name: '9, New Road, New Colony, Hyderabad, Telangana, 500072',
          name: 'New Landmark',
          address: {
            house_number: '9',
            road: 'New Road',
            neighbourhood: 'New Colony',
            city_district: 'Kukatpally',
            city: 'Hyderabad',
            state_district: 'Medchal-Malkajgiri',
            state: 'Telangana',
            postcode: '500072'
          }
        })
      });
    }

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

    if (url.pathname === '/api/delivery-offers' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        settings: { freeDeliveryEnabled: true, freeDeliveryThreshold: 800, standardDeliveryFee: 30 }
      }) });
    }

    if (url.pathname === '/api/coupons/available' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coupons: [] }) });
    }

    if (url.pathname === '/api/checkout/quote' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const qty = Number(payload.items?.[0]?.qty || 1);
      const itemsSubtotal = 120 * qty;
      const discount = 0;
      const deliveryFee = itemsSubtotal >= 800 ? 0 : 30;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pricing: {
          itemsSubtotal, freeDeliveryEnabled: true, freeDeliveryThreshold: 800,
          qualifiesForFreeDelivery: itemsSubtotal >= 800, amountToFreeDelivery: Math.max(0, 800 - itemsSubtotal),
          standardDeliveryFee: 30, deliveryFee, couponDiscount: discount, finalTotal: itemsSubtotal - discount + deliveryFee,
          coupon: null,
          items: [{ id: 'p1', name: 'Basmati Rice', unit: 'kg', qty, price: 120, lineTotal: 120 * qty }]
        } })
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
          total: Number(payload.expectedTotal ?? 150),
          itemsSubtotal: 120,
          deliveryFee: 30,
          couponCode: null,
          couponDiscount: 0,
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
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹150');
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
  // Saving from checkout returns directly to checkout with the new address selected.
  await expect(page.locator('#fwCheckoutAddressSummary')).toContainText('E2E Customer');
  await expect(page.locator('#fwCheckoutAddressSummary')).toContainText('New Road');

  await page.locator('#checkoutForm button[type="submit"]').click();

  await expect(page.locator('#confirmationView')).toBeVisible();
  await expect(page.locator('#confirmationView')).toContainText('FW-E2E-0001');
  await expect(page.locator('#confirmationView')).toContainText('Payment: Cash');
  await expect(page.locator('#confirmationView')).toContainText('Delivery plan: Tomorrow');
  await expect(page.locator('#confirmationView')).toContainText('Items subtotal');
  await expect(page.locator('#confirmationView')).toContainText('₹120');
  await expect(page.locator('#confirmationView')).toContainText('Delivery fee');
  await expect(page.locator('#confirmationView')).toContainText('₹30');
  await expect(page.locator('#confirmationView')).toContainText('₹150');
  await expect(page.locator('#cartCount')).toHaveText('0 items');
});

test('selecting a new pin replaces stale geographic fields but preserves customer details', async ({ page }) => {
  savedAddresses = [{
    id: 41,
    label: 'Home',
    recipientName: 'Narayana Nagapuri',
    deliveryPhone: '7702661401',
    houseFlat: '1-12/23/c, old plot',
    building: 'Old apartment',
    floor: '3',
    street: 'Old Road',
    area: 'Old Colony',
    locality: 'Old Locality',
    city: 'Old City',
    district: 'Old District',
    state: 'Old State',
    pincode: '505209',
    landmark: 'Old temple',
    note: 'Call before delivery',
    latitude: 17.30,
    longitude: 78.30,
    accuracyMeters: 20,
    locationSource: 'GPS',
    placeId: 'old-place',
    locationUpdatedAt: '2026-10-01T00:00:00.000Z',
    isDefault: true
  }];

  await page.goto('/');
  await page.locator('#addressBtn').click();
  await expect(page.locator('[data-fw-edit="41"]')).toBeVisible();
  await page.locator('[data-fw-edit="41"]').click();

  await expect(page.locator('#fwAddrHouse')).toHaveValue('1-12/23/c, old plot');
  await expect(page.locator('#fwAddrPincode')).toHaveValue('505209');
  await page.locator('#fwAddressGps').click();
  await expect(page.locator('#fwAddressLocationStatus')).toContainText('Delivery pin selected');

  await expect(page.locator('#fwAddrHouse')).toHaveValue('9');
  await expect(page.locator('#fwAddrBuilding')).toHaveValue('');
  await expect(page.locator('#fwAddrFloor')).toHaveValue('');
  await expect(page.locator('#fwAddrStreet')).toHaveValue('New Road');
  await expect(page.locator('#fwAddrArea')).toHaveValue('New Colony');
  await expect(page.locator('#fwAddrLocality')).toHaveValue('Kukatpally');
  await expect(page.locator('#fwAddrCity')).toHaveValue('Hyderabad');
  await expect(page.locator('#fwAddrDistrict')).toHaveValue('Medchal-Malkajgiri');
  await expect(page.locator('#fwAddrState')).toHaveValue('Telangana');
  await expect(page.locator('#fwAddrPincode')).toHaveValue('500072');
  await expect(page.locator('#fwAddrLandmark')).toHaveValue('New Landmark');

  await expect(page.locator('#fwAddrName')).toHaveValue('Narayana Nagapuri');
  await expect(page.locator('#fwAddrPhone')).toHaveValue('7702661401');
  await expect(page.locator('#fwAddrNote')).toHaveValue('Call before delivery');

  await page.locator('#fwAddressSave').click();
  await expect.poll(() => savedAddresses.find(address => Number(address.id) === 41)?.pincode).toBe('500072');
  const saved = savedAddresses.find(address => Number(address.id) === 41);
  expect(saved.street).toBe('New Road');
  expect(saved.houseFlat).toBe('9');
  expect(saved.latitude).toBe(17.385044);
  expect(saved.longitude).toBe(78.486671);
  expect(saved.recipientName).toBe('Narayana Nagapuri');
  expect(saved.note).toBe('Call before delivery');
});

test('customer shell exposes the direct-install PWA contract', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/FreshWay/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f7a4b');
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('#main-content')).toBeVisible();
});
