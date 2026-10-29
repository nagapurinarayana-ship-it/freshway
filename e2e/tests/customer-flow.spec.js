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
    // Reset once per isolated test page, not on every reload: selection persistence is part of the customer contract.
    if (sessionStorage.getItem('__freshwayE2EInitialized') !== '1') {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__freshwayE2EInitialized', '1');
    }
    // This flow is testing delivery addresses, not the separate timed install-help nudge.
    sessionStorage.setItem('freshway-pwa-install-nudge', '1');
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

    if (url.pathname === '/api/store-profile' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ storeProfile: {
          storeName: 'FreshWay Test Store',
          address: '12 Example Market, Test Colony, Hyderabad, Telangana 500001',
          phone: '9000000000',
          whatsapp: '9000000000',
          email: 'privacy@example.test',
          about: 'Fresh groceries and everyday essentials, selected for quality and delivered locally with care.',
          businessHours: 'Monday–Saturday, 9:00 AM–7:00 PM',
          deliveryInfo: 'Local delivery slots are confirmed during checkout. Delivery availability depends on your address.'
        } })
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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coupons: [
        { code: 'TEST50', title: 'E2E fixed offer', discountAmount: 50, eligible: true, firstOrderOnly: false }
      ] }) });
    }

    if (url.pathname === '/api/checkout/quote' && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}');
      const qty = Number(payload.items?.[0]?.qty || 1);
      const itemsSubtotal = 120 * qty;
      const couponCode = String(payload.couponCode || '').trim().toUpperCase();
      const discount = couponCode === 'TEST50' ? 50 : 0;
      const deliveryFee = itemsSubtotal >= 800 ? 0 : 30;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pricing: {
          itemsSubtotal, freeDeliveryEnabled: true, freeDeliveryThreshold: 800,
          qualifiesForFreeDelivery: itemsSubtotal >= 800, amountToFreeDelivery: Math.max(0, 800 - itemsSubtotal),
          standardDeliveryFee: 30, deliveryFee, couponDiscount: discount, finalTotal: itemsSubtotal - discount + deliveryFee,
          coupon: discount > 0 ? { code: couponCode, eligibilityPending: false } : null,
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
          pricingBreakdownKnown: true,
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
  await expect(page.locator('#fwAvailableCoupons')).toContainText('TEST50');

  await page.locator('#fwCouponCode').fill('TEST50');
  await page.locator('[data-fw-apply-coupon]').click();
  await expect(page.locator('#fwDeliveryPricing')).toContainText('Coupon TEST50');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹100');
  await expect(page.locator('#fwCouponStatus')).toContainText('Coupon applied');

  // Clearing an applied code and pressing Apply must remove the discount,
  // not restore the old code or require a second Remove coupon button.
  await page.locator('#fwCouponCode').fill('');
  await page.locator('[data-fw-apply-coupon]').click();
  await expect(page.locator('#fwCouponCode')).toHaveValue('');
  await expect(page.locator('#fwCouponStatus')).toContainText('Coupon removed');
  await expect(page.locator('#fwDeliveryPricing')).not.toContainText('Coupon TEST50');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹150');

  // A resume/freshness refresh must not replace the live cart summary with
  // the legacy price-only layout while coupon options are already visible.
  const refreshedProducts = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/products' &&
    response.request().method() === 'GET'
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refreshedProducts;
  await expect(page.locator('#fwAvailableCoupons')).toContainText('TEST50');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹150');
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    window.scrollTo(0, 0);
  });
  await expect(page.locator('#fwAvailableCoupons')).toContainText('TEST50');
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

test('checkout button shows the final payable total, not the item subtotal', async ({ page }) => {
  // Reproduce the reported production example: ₹799 subtotal, ₹50 coupon,
  // ₹100 delivery fee means ₹849 payable. Cart-bar refreshes must not replace
  // the checkout button's server-quoted total with the subtotal.
  await page.route('**/api/products', async route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ products: [{ ...products[0], price: 799 }] })
    });
  });
  await page.route('**/api/checkout/quote', async route => {
    const payload = JSON.parse(route.request().postData() || '{}');
    const qty = Number(payload.items?.[0]?.qty || 1);
    const itemsSubtotal = 799 * qty;
    const couponCode = String(payload.couponCode || '').trim().toUpperCase();
    const couponDiscount = couponCode === 'FUN' ? 50 : 0;
    const deliveryFee = 100;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pricing: {
        itemsSubtotal,
        freeDeliveryEnabled: true,
        freeDeliveryThreshold: 800,
        qualifiesForFreeDelivery: itemsSubtotal >= 800,
        amountToFreeDelivery: Math.max(0, 800 - itemsSubtotal),
        standardDeliveryFee: deliveryFee,
        deliveryFee,
        couponDiscount,
        finalTotal: itemsSubtotal - couponDiscount + deliveryFee,
        coupon: couponDiscount ? { code: couponCode, eligibilityPending: false } : null,
        items: [{ id: 'p1', name: 'Basmati Rice', unit: 'kg', qty, price: 799, lineTotal: itemsSubtotal }]
      } })
    });
  });

  await page.goto('/');
  await expect(page.locator('[data-fw-category="cat-rice"]')).toContainText('Rice');
  await page.locator('[data-fw-category="cat-rice"]').click();
  await expect(page.locator('#productGrid')).toBeVisible();
  await expect(page.locator('#productGrid .product-card')).toContainText('Basmati Rice');
  await page.locator('#productGrid .add-btn').click();
  await expect(page.locator('#cartTotal')).toHaveText('₹799');
  await page.locator('#viewCartBtn').click();

  await page.locator('#fwCouponCode').fill('FUN');
  await page.locator('[data-fw-apply-coupon]').click();
  await expect(page.locator('#fwDeliveryPricing')).toContainText('Coupon FUN');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹799');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('−₹50');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹100');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹849');

  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹849');
  const placeOrder = page.locator('#checkoutForm button[type="submit"]');
  await expect(placeOrder).toContainText('₹849');
  await expect(placeOrder).not.toContainText('₹799');
});

test('₹1,850 cart item persists through checkout navigation and page refresh', async ({ page }) => {
  const quotePayloads = [];
  let productRequests = 0;
  await page.route('**/api/products', async route => {
    productRequests += 1;
    // Simulate a slow catalogue response on reload so checkout restores before products arrive.
    if (productRequests > 1) await new Promise(resolve => setTimeout(resolve, 600));
    return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ products: [{
      id: 42,
      name: 'Groundnut oil/5ltrs',
      unit: 'kg',
      price: 1850,
      emoji: '🛢️',
      active: 1,
      category_id: 'cat-rice',
      category_name: 'Rice',
      category_slug: 'rice'
    }] })
    });
  });
  await page.route('**/api/checkout/quote', async route => {
    const payload = JSON.parse(route.request().postData() || '{}');
    quotePayloads.push(payload);
    const item = payload.items?.[0] || {};
    if (String(item.id) !== '42') {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Cart item changed unexpectedly.' }) });
    }
    const qty = Number(item.qty || 1);
    const itemsSubtotal = 1850 * qty;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pricing: {
        itemsSubtotal,
        freeDeliveryEnabled: true,
        freeDeliveryThreshold: 800,
        qualifiesForFreeDelivery: true,
        amountToFreeDelivery: 0,
        standardDeliveryFee: 100,
        deliveryFee: 0,
        couponDiscount: 0,
        finalTotal: itemsSubtotal,
        coupon: null,
        items: [{ id: 42, name: 'Groundnut oil/5ltrs', unit: 'kg', qty, price: 1850, lineTotal: itemsSubtotal }]
      } })
    });
  });

  await page.goto('/');
  await expect(page.locator('[data-fw-category="cat-rice"]')).toContainText('Rice');
  await page.locator('[data-fw-category="cat-rice"]').click();
  await expect(page.locator('#productGrid .product-card')).toContainText('Groundnut oil/5ltrs');
  await page.locator('#productGrid .add-btn').click();
  await expect(page.locator('#cartTotal')).toHaveText('₹1,850');
  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#cartItems')).toContainText('Groundnut oil/5ltrs');
  await expect(page.locator('#fwDeliveryPricing')).toContainText('₹1,850');
  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹1,850');
  await expect(page.locator('#checkoutForm button[type="submit"]')).toContainText('₹1,850');

  const savedBeforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('freshway-state-v2') || '{}'));
  expect(savedBeforeReload.cart['42']).toBe(1);
  expect(savedBeforeReload.cartProducts['42'].price).toBe(1850);
  // Emulate a cart saved by the older app version, which stored only IDs and quantities.
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('freshway-state-v2') || '{}');
    delete state.cartProducts;
    localStorage.setItem('freshway-state-v2', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect(page.locator('#fwCheckoutPricing')).toContainText('₹1,850');
  await expect(page.locator('#checkoutForm button[type="submit"]')).toContainText('₹1,850');
  const savedAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('freshway-state-v2') || '{}'));
  expect(savedAfterReload.cart['42']).toBe(1);
  expect(savedAfterReload.cartProducts['42'].name).toBe('Groundnut oil/5ltrs');
  expect(quotePayloads.length).toBeGreaterThanOrEqual(2);
  expect(quotePayloads.every(payload => String(payload.items?.[0]?.id) === '42')).toBe(true);
});

test('checkout refuses a quote for a different cart item instead of showing a mismatched price', async ({ page }) => {
  await page.route('**/api/products', async route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ products: [{
      id: 42,
      name: 'Groundnut oil/5ltrs',
      unit: 'kg',
      price: 1850,
      emoji: '🛢️',
      active: 1,
      category_id: 'cat-rice',
      category_name: 'Rice',
      category_slug: 'rice'
    }] })
  }));
  await page.route('**/api/checkout/quote', async route => {
    const payload = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pricing: {
        itemsSubtotal: 799,
        freeDeliveryEnabled: true,
        freeDeliveryThreshold: 800,
        qualifiesForFreeDelivery: false,
        amountToFreeDelivery: 1,
        standardDeliveryFee: 100,
        deliveryFee: 100,
        couponDiscount: 0,
        finalTotal: 899,
        coupon: null,
        items: [{ id: 'p1', name: 'Different item', unit: 'kg', qty: Number(payload.items?.[0]?.qty || 1), price: 799, lineTotal: 799 }]
      } })
    });
  });

  await page.goto('/');
  await page.locator('[data-fw-category="cat-rice"]').click();
  await page.locator('#productGrid .add-btn').click();
  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#fwCouponStatus')).toContainText('We could not verify every cart item');
  await page.locator('#checkoutBtn').click();
  const placeOrder = page.locator('#checkoutForm button[type="submit"]');
  await expect(placeOrder).toBeDisabled();
  await expect(placeOrder).toContainText('Total unavailable');
  await expect(page.locator('#fwCheckoutPricing')).toContainText('Could not refresh your order total');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('freshway-state-v2') || '{}'));
  expect(saved.cart['42']).toBe(1);
  expect(saved.cartProducts['42'].name).toBe('Groundnut oil/5ltrs');
  await expect(placeOrder).not.toContainText('₹799');
  await expect(placeOrder).not.toContainText('₹0');
});

test('selected delivery day survives checkout page refresh', async ({ page }) => {
  await page.route('**/api/checkout/quote', async route => {
    const payload = JSON.parse(route.request().postData() || '{}');
    const requested = Array.isArray(payload.items) ? payload.items : [];
    const items = [];
    for (const item of requested) {
      const product = products.find(p => String(p.id) === String(item.id));
      if (!product) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Product unavailable.' }) });
      }
      const qty = Number(item.qty || 0);
      items.push({ id: product.id, name: product.name, unit: product.unit, qty, price: product.price, lineTotal: product.price * qty });
    }
    const itemsSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const qualifiesForFreeDelivery = itemsSubtotal >= 800;
    const deliveryFee = qualifiesForFreeDelivery ? 0 : 30;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pricing: {
        itemsSubtotal,
        freeDeliveryEnabled: true,
        freeDeliveryThreshold: 800,
        qualifiesForFreeDelivery,
        amountToFreeDelivery: Math.max(0, 800 - itemsSubtotal),
        standardDeliveryFee: 30,
        deliveryFee,
        couponDiscount: 0,
        finalTotal: itemsSubtotal + deliveryFee,
        coupon: null,
        items
      } })
    });
  });

  await page.goto('/');
  await page.locator('[data-fw-category="cat-rice"]').click();
  await page.locator('#productGrid .add-btn').click();
  await page.locator('#viewCartBtn').click();
  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await page.locator('[data-fw-date-choice="tomorrow"]').click();
  const summaryBeforeReload = (await page.locator('.fw-delivery-date-summary').textContent() || '').replace(/\s+/g, ' ').trim();
  await expect(page.locator('[data-fw-date-choice="tomorrow"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect(page.locator('.fw-delivery-date-summary')).toHaveText(summaryBeforeReload);
  await expect(page.locator('[data-fw-date-choice="tomorrow"]')).toHaveAttribute('aria-pressed', 'true');
});

test('new address defaults to registered name/mobile but lets the customer edit both', async ({ page }) => {
  let sessionCalls = 0;
  let registrationDetailsAvailable = false;
  await page.route('**/api/auth/session', async route => {
    sessionCalls += 1;
    // Keep registration details unavailable until the customer explicitly
    // opens Add address, then verify that the address flow refreshes the session.
    const customer = registrationDetailsAvailable
      ? { customerId: 'e2e-customer-registered', name: 'Registered Full Name', registeredPhone: '919876543210' }
      : { customerId: 'e2e-customer-registered' };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(customer)
    });
  });

  await page.goto('/');
  await page.locator('#addressBtn').click();
  await expect(page.locator('#fwAddressManagerNew')).toBeVisible();
  const sessionsBeforeAdd = sessionCalls;
  registrationDetailsAvailable = true;
  await page.locator('#fwAddressManagerNew').click();

  await expect(page.locator('#fwAddrName')).toHaveValue('Registered Full Name');
  await expect(page.locator('#fwAddrPhone')).toHaveValue('9876543210');
  expect(sessionCalls).toBeGreaterThan(sessionsBeforeAdd);

  // Both registered values are defaults, not read-only account fields.
  await page.locator('#fwAddrName').fill('Alternate Recipient');
  await page.locator('#fwAddrPhone').fill('9123456789');
  await page.locator('#fwAddrHouse').fill('22-B');
  await page.locator('#fwAddrArea').fill('Test Colony');
  await page.locator('#fwAddrCity').fill('Hyderabad');
  await page.locator('#fwAddrPincode').fill('500072');
  await page.locator('#fwAddressGps').click();
  await expect(page.locator('#fwAddressLocationStatus')).toContainText('Delivery pin selected');
  await expect(page.locator('#fwAddrName')).toHaveValue('Alternate Recipient');
  await expect(page.locator('#fwAddrPhone')).toHaveValue('9123456789');

  await page.locator('#fwAddressSave').click();
  await expect.poll(() => savedAddresses.length).toBe(1);
  expect(savedAddresses[0].recipientName).toBe('Alternate Recipient');
  expect(savedAddresses[0].deliveryPhone).toBe('9123456789');
  expect(savedAddresses[0].houseFlat).toBe('9');
  expect(savedAddresses[0].area).toBe('New Colony');
  expect(savedAddresses[0].city).toBe('Hyderabad');
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

test('new address added from Home becomes the selected address across screens and refresh', async ({ page }) => {
  savedAddresses = [{
    id: 41,
    label: 'Home',
    recipientName: 'Default Recipient',
    deliveryPhone: '9876543210',
    houseFlat: '1',
    building: '',
    floor: '',
    street: 'Default Road',
    area: 'Default Colony',
    locality: 'Default Locality',
    city: 'Hyderabad',
    district: '',
    state: 'Telangana',
    pincode: '500001',
    landmark: '',
    note: '',
    latitude: 17.30,
    longitude: 78.30,
    accuracyMeters: 10,
    locationSource: 'GPS',
    placeId: 'default-place',
    locationUpdatedAt: '2026-10-01T00:00:00.000Z',
    isDefault: true
  }];

  await page.goto('/');
  await expect(page.locator('#homeAddress')).toContainText('Default Colony');
  await page.locator('#addressBtn').click();
  await expect(page.locator('[data-fw-edit="41"]')).toBeVisible();
  await page.locator('#fwAddressManagerNew').click();

  await page.locator('#fwAddrName').fill('New Recipient');
  await page.locator('#fwAddrPhone').fill('9876543211');
  await page.locator('#fwAddrHouse').fill('9');
  await page.locator('#fwAddrArea').fill('Typed Area');
  await page.locator('#fwAddrCity').fill('Hyderabad');
  await page.locator('#fwAddrPincode').fill('500001');
  await page.locator('#fwAddressGps').click();
  await expect(page.locator('#fwAddressLocationStatus')).toContainText('Delivery pin selected');
  await page.locator('#fwAddressSave').click();

  await expect(page.locator('[data-fw-use="42"]')).toBeVisible();
  await expect(page.locator('.fw-address-card.is-selected')).toContainText('New Colony');
  await page.locator('#addressModal [data-close-modal]').click();
  await expect(page.locator('#homeAddress')).toContainText('New Colony');

  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileAddressText')).toContainText('New Colony');
  await page.evaluate(() => window.setView('checkout'));
  await expect(page.locator('#fwCheckoutAddressSummary')).toContainText('New Colony');

  // The explicitly selected saved address must survive a full refresh independently of the saved default.
  await page.reload();
  await expect(page.locator('#homeAddress')).toContainText('New Colony');
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileAddressText')).toContainText('New Colony');
  await page.evaluate(() => window.setView('checkout'));
  await expect(page.locator('#fwCheckoutAddressSummary')).toContainText('New Colony');
});

test('customer shell exposes the direct-install PWA contract', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/FreshWay/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f7a4b');
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('#main-content')).toBeVisible();
});


test('refresh and browser back/forward restore the correct view without showing legacy Home', async ({ page }) => {
  await page.addInitScript(() => {
    const state = history.state;
    const valid = new Set(['home', 'cart', 'checkout', 'orders', 'messages', 'profile', 'about', 'contact', 'confirmation']);
    const hash = location.hash.slice(1);
    const saved = state?.__freshwayCustomer && valid.has(state.view) ? state.view : (valid.has(hash) && hash !== 'confirmation' ? hash : '');
    if (!saved || saved === 'home') return;
    window.__freshwayLegacyHomeFlash = false;
    const inspect = () => {
      const app = document.querySelector('#app');
      const home = document.querySelector('#homeView');
      if (app && home?.classList.contains('active-view') && getComputedStyle(app).visibility !== 'hidden') {
        window.__freshwayLegacyHomeFlash = true;
      }
    };
    new MutationObserver(inspect).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });
  });

  await page.goto('/');
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileView')).toHaveClass(/active-view/);
  await page.locator('#profileView [data-nav="orders"]').click();
  await expect(page.locator('#ordersView')).toHaveClass(/active-view/);

  await page.reload();
  await expect(page.locator('#ordersView')).toHaveClass(/active-view/);
  await expect(page.locator('#homeView')).not.toHaveClass(/active-view/);
  expect(await page.evaluate(() => window.__freshwayLegacyHomeFlash || false)).toBe(false);

  await page.goBack();
  await expect(page.locator('#profileView')).toHaveClass(/active-view/);
  await expect(page.locator('#homeView')).not.toHaveClass(/active-view/);

  await page.goForward();
  await expect(page.locator('#ordersView')).toHaveClass(/active-view/);
  await expect(page.locator('#homeView')).not.toHaveClass(/active-view/);

  // A new direct URL with a view hash must also choose the requested screen
  // before the default Home markup can be painted.
  await page.goto('/?nav-refresh-test=1#profile');
  await expect(page.locator('#profileView')).toHaveClass(/active-view/);
  await expect(page.locator('#homeView')).not.toHaveClass(/active-view/);
  expect(await page.evaluate(() => window.__freshwayLegacyHomeFlash || false)).toBe(false);
});

test('captures responsive customer visual review snapshots', async ({ page }) => {
  const capture = async name => {
    // Capture an actual viewport, not a stitched full-page image that can
    // misplace sticky headers and fixed navigation during screenshot stitching.
    await expect(page.locator('#toast')).not.toHaveClass(/show/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/visual-review/${name}.png`,
      fullPage: false,
      animations: 'disabled'
    });
  };

  // Mobile-first review: actual customer shell, product cards, cart, and checkout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#productGrid .product-card')).toContainText('Basmati Rice');
  await expect(page.locator('#cartBar')).toBeHidden();
  await capture('mobile-home');

  await page.locator('[data-fw-category="cat-rice"]').click();
  await page.locator('#productGrid .add-btn').click();
  await expect(page.locator('#cartCount')).toHaveText('1 item');
  const compactCardLayout = await page.locator('#productGrid .product-card').first().evaluate(card => {
    const cardRect = card.getBoundingClientRect();
    const controls = card.querySelector('.product-action-control .qty-control');
    const controlRect = controls?.getBoundingClientRect();
    return {
      cardBottom: cardRect.bottom,
      controlBottom: controlRect?.bottom ?? 0,
      controlHeight: controlRect?.height ?? 0,
      controlVisible: !!controlRect && controlRect.width > 0 && controlRect.height > 0
    };
  });
  expect(compactCardLayout.controlVisible, 'quantity control should be visible in the compact product card').toBe(true);
  expect(compactCardLayout.controlHeight, 'quantity control should retain a usable height').toBeGreaterThanOrEqual(27);
  expect(compactCardLayout.controlBottom, 'quantity control should not be clipped by its product card').toBeLessThanOrEqual(compactCardLayout.cardBottom + 1);
  await expect(page.locator('#cartBar')).toBeVisible();
  await capture('mobile-home-with-cart');

  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#checkoutBtn')).toBeVisible();
  await capture('mobile-cart');

  await page.locator('#checkoutBtn').click();
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await expect(page.locator('#checkoutForm')).toBeVisible();
  await capture('mobile-checkout');

  await page.evaluate(() => window.setView('profile'));
  await expect(page.locator('#profileView')).toHaveClass(/active-view/);
  await capture('mobile-profile');

  await page.evaluate(() => window.setView('orders'));
  await expect(page.locator('#ordersView')).toHaveClass(/active-view/);
  await capture('mobile-orders');

  // About and Contact are real customer-facing pages and need their own visual review.
  await page.evaluate(() => window.setView('about'));
  await expect(page.locator('#aboutView')).toHaveClass(/active-view/);
  await expect(page.locator('#aboutContent .store-about-hero')).toBeVisible();
  await expect(page.locator('#aboutContent .store-info-about')).toContainText('Fresh groceries and everyday essentials');
  await expect(page.locator('#aboutContent .store-contact-cta')).toBeVisible();
  await expect(page.locator('#cartBar')).toBeHidden();
  await capture('mobile-about');

  await page.evaluate(() => window.setView('contact'));
  await expect(page.locator('#contactView')).toHaveClass(/active-view/);
  await expect(page.locator('#contactContent .store-page-intro')).toContainText('Reach FreshWay');
  await expect(page.locator('#contactContent [data-customer-message-form]')).toBeVisible();
  await expect(page.locator('#contactContent input[name="subject"]')).toBeVisible();
  await expect(page.locator('#contactContent textarea[name="message"]')).toBeVisible();
  await expect(page.locator('#contactContent .store-contact-actions')).toContainText('WhatsApp');
  await expect(page.locator('#cartBar')).toBeHidden();
  await capture('mobile-contact');

  // Privacy Policy is a separate public page, so test the direct URL as well as its responsive content.
  const privacyPage = await page.context().newPage();
  await privacyPage.route('**/api/store-profile', async route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ storeProfile: {
      storeName: 'FreshWay Test Store',
      address: '12 Example Market, Test Colony, Hyderabad, Telangana 500001',
      phone: '9000000000',
      whatsapp: '9000000000',
      email: 'privacy@example.test'
    } })
  }));
  await privacyPage.setViewportSize({ width: 390, height: 844 });
  await privacyPage.goto('/privacy.html');
  await expect(privacyPage.locator('h1')).toHaveText('Privacy Policy');
  await expect(privacyPage.locator('#privacyContact')).toHaveAttribute('aria-busy', 'false');
  await expect(privacyPage.locator('#privacyContact')).toContainText('privacy@example.test');
  await expect(privacyPage.locator('.note').last()).toContainText('Operator review required');
  await privacyPage.screenshot({
    path: 'test-results/visual-review/mobile-privacy-policy.png',
    fullPage: true,
    animations: 'disabled'
  });

  // Desktop-width snapshots verify that responsive layouts do not become stretched.
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.evaluate(() => window.setView('home'));
  await expect(page.locator('#homeView')).toHaveClass(/active-view/);
  await capture('desktop-home');

  await page.evaluate(() => window.setView('about'));
  await expect(page.locator('#aboutContent .store-about-hero')).toBeVisible();
  await capture('desktop-about');

  await page.evaluate(() => window.setView('contact'));
  await expect(page.locator('#contactContent [data-customer-message-form]')).toBeVisible();
  await capture('desktop-contact');

  await privacyPage.setViewportSize({ width: 1365, height: 900 });
  await privacyPage.screenshot({
    path: 'test-results/visual-review/desktop-privacy-policy.png',
    fullPage: true,
    animations: 'disabled'
  });
  await privacyPage.close();

  await page.evaluate(() => window.setView('home'));
  await expect(page.locator('#homeView')).toHaveClass(/active-view/);
  await page.locator('[data-fw-category="cat-rice"]').click();
  await expect(page.locator('#productGrid .product-card')).toContainText('Basmati Rice');
  const desktopCardLayout = await page.locator('#productGrid .product-card').first().evaluate(card => {
    const cardRect = card.getBoundingClientRect();
    const controls = card.querySelector('.product-action-control .qty-control');
    const controlRect = controls?.getBoundingClientRect();
    return {
      cardBottom: cardRect.bottom,
      controlBottom: controlRect?.bottom ?? 0,
      controlHeight: controlRect?.height ?? 0,
      controlVisible: !!controlRect && controlRect.width > 0 && controlRect.height > 0,
      cardWidth: cardRect.width
    };
  });
  expect(desktopCardLayout.cardWidth, 'desktop catalogue cards should use the wide-screen grid').toBeGreaterThan(220);
  expect(desktopCardLayout.controlVisible, 'desktop quantity control should be visible').toBe(true);
  expect(desktopCardLayout.controlBottom, 'desktop quantity control should not be clipped').toBeLessThanOrEqual(desktopCardLayout.cardBottom + 1);
  await capture('desktop-products');
  await page.locator('#fwCategoryBack button').click();

  await page.evaluate(() => window.setView('cart'));
  await expect(page.locator('#cartView')).toHaveClass(/active-view/);
  await capture('desktop-cart');

  await page.evaluate(() => window.setView('checkout'));
  await expect(page.locator('#checkoutView')).toHaveClass(/active-view/);
  await capture('desktop-checkout');

  // The Profile entry must actually open the public privacy page, not just render a static URL in isolation.
  await page.evaluate(() => window.setView('profile'));
  await page.locator('#privacyPolicyBtn').click();
  await expect(page).toHaveURL(/\/privacy\.html$/);
  await expect(page.locator('h1')).toHaveText('Privacy Policy');
  await expect(page.locator('#privacyContact')).toContainText('privacy@example.test');
});


test('captures the remaining implemented customer screens and modal states', async ({ page }) => {
  const capture = async name => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: 'test-results/visual-review/' + name + '.png',
      fullPage: false,
      animations: 'disabled'
    });
  };

  await page.route('**/api/auth/passcode-reset/start', async route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, message: 'If this mobile is registered, a verification code has been sent.' })
  }));

  savedAddresses = [{
    id: 51,
    label: 'Home',
    recipientName: 'E2E Customer',
    deliveryPhone: '9876543210',
    houseFlat: '12',
    building: '',
    floor: '',
    street: 'Example Street',
    area: 'Test Colony',
    locality: 'Test Colony',
    city: 'Hyderabad',
    district: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    landmark: 'Near test market',
    note: 'Call before delivery',
    latitude: 17.385044,
    longitude: 78.486671,
    accuracyMeters: 10,
    locationSource: 'GPS',
    placeId: 'e2e-home',
    locationUpdatedAt: '2026-10-29T00:00:00.000Z',
    isDefault: true
  }];

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#addressBtn').click();
  await expect(page.locator('#addressModal')).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-fw-edit="51"]')).toBeVisible();
  await capture('mobile-address-manager');
  await page.locator('#addressModal [data-close-modal]').click();
  await expect(page.locator('#addressModal')).toHaveClass(/hidden/);

  // The production authentication surface is the dynamic passcode modal,
  // not the legacy static OTP markup retained in the HTML shell.
  await page.evaluate(() => { window.FreshWayNotifications.login().catch(() => {}); });
  await expect(page.locator('#passcodeModal')).toBeVisible();
  await expect(page.locator('#passcodePhone')).toBeVisible();
  await capture('mobile-passcode-login');

  await page.locator('#passcodeMode').click();
  await expect(page.locator('#passcodeName')).toBeVisible();
  await expect(page.locator('#passcodeConfirm')).toBeVisible();
  await capture('mobile-passcode-registration');

  await page.locator('#passcodeMode').click();
  await page.locator('#passcodeForgot').click();
  await expect(page.locator('#passcodeHint')).toContainText('verification code');
  await expect(page.locator('#passcodeResetCode')).toBeHidden();
  await capture('mobile-passcode-recovery-start');

  await page.locator('#passcodePhone').fill('9876543210');
  await page.locator('#passcodeSubmit').click();
  await expect(page.locator('#passcodeResetCode')).toBeVisible();
  await expect(page.locator('#passcodeResetNew')).toBeVisible();
  await expect(page.locator('#passcodeResetConfirm')).toBeVisible();
  await capture('mobile-passcode-recovery-code');
  await page.locator('#passcodeCancel').click();
  await expect(page.locator('#passcodeModal')).toBeHidden();

  // Permission help is reachable when browser/site notifications are blocked.
  await page.evaluate(() => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'denied' }
    });
    window.setView('profile');
  });
  await page.locator('#enableNotifications').click();
  await expect(page.locator('#notificationPermissionHelp')).toBeVisible();
  await expect(page.locator('#notificationPermissionHelp')).toContainText('Allow order updates');
  await capture('mobile-notification-permission-help');
  await page.locator('#notificationPermissionHelp [data-notification-permission-close]').first().click();
  await expect(page.locator('#notificationPermissionHelp')).toHaveCount(0);

  await page.evaluate(() => window.FreshWayPwaInstall.showInstallHelp());
  await expect(page.locator('.pwa-help')).toBeVisible();
  await expect(page.locator('.pwa-help')).toContainText('Install FreshWay');
  await capture('mobile-pwa-install-help');

  // Desktop snapshots verify these existing overlays retain usable width and spacing.
  await page.setViewportSize({ width: 1365, height: 900 });
  await capture('desktop-pwa-install-help');
  await page.locator('.pwa-help .icon-btn').click();
  await page.evaluate(() => window.setView('home'));
  await page.locator('#addressBtn').click();
  await expect(page.locator('[data-fw-edit="51"]')).toBeVisible();
  await capture('desktop-address-manager');
});

test('captures customer Messages populated, empty, error and desktop states', async ({ page }) => {
  let messages = [{
    id: 'msg-e2e-1',
    subject: 'Delivery update',
    message: 'Could you confirm the delivery date?',
    created_at: '2026-10-28T10:00:00.000Z',
    status: 'replied',
    reply_seen_at: null,
    replied_at: '2026-10-28T11:00:00.000Z',
    admin_reply: 'Your order is scheduled for tomorrow.',
    order_id: 'FW-E2E-MSG-1'
  }];
  let failMessages = false;

  await page.route('**/api/customer/messages**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/customer/messages/unread-count' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unreadCount: 1 }) });
    }
    if (url.pathname === '/api/customer/messages/read' && request.method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, markedRead: 1 }) });
    }
    if (url.pathname === '/api/customer/messages' && request.method() === 'GET') {
      if (failMessages) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Message service is temporarily unavailable.' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test message endpoint.' }) });
  });

  const capture = async name => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: 'test-results/visual-review/' + name + '.png',
      fullPage: false,
      animations: 'disabled'
    });
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => window.setView('messages'));
  await expect(page.locator('#customerMessagesContent [data-customer-message-id]')).toContainText('Delivery update');
  await expect(page.locator('#customerMessagesContent .fw-customer-message-reply')).toContainText('scheduled for tomorrow');
  await capture('mobile-messages-populated');

  messages = [];
  await page.evaluate(() => window.FreshWayCustomerMessages.load());
  await expect(page.locator('#customerMessagesContent')).toContainText('No messages yet');
  await expect(page.locator('#customerMessagesContent [data-messages-contact]')).toBeVisible();
  await capture('mobile-messages-empty');

  failMessages = true;
  await page.evaluate(() => window.FreshWayCustomerMessages.load());
  await expect(page.locator('#customerMessagesContent')).toContainText('Could not load messages');
  await expect(page.locator('#customerMessagesContent [data-messages-refresh]')).toBeVisible();
  await capture('mobile-messages-error');

  failMessages = false;
  messages = [{
    id: 'msg-e2e-2',
    subject: 'Customer support',
    message: 'Please check my delivery.',
    created_at: '2026-10-28T10:00:00.000Z',
    status: 'pending',
    reply_seen_at: null,
    replied_at: null,
    admin_reply: null,
    order_id: null
  }];
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.evaluate(() => window.FreshWayCustomerMessages.load());
  await expect(page.locator('#customerMessagesContent [data-customer-message-id]')).toContainText('Customer support');
  await capture('desktop-messages-populated');
});

test('captures populated orders, delivery rescheduling, order help, invoice download and confirmation', async ({ page }) => {
  const orderId = 'FW-QA-1001';
  const scheduledDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sentRequests = [];
  const sampleOrder = () => ({
    id: orderId,
    status: 'Confirmed',
    payment: 'Not Collected',
    deliveryPlan: 'Tomorrow',
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    total: 150,
    pricingBreakdownKnown: true,
    itemsSubtotal: 120,
    deliveryFee: 30,
    couponCode: null,
    couponDiscount: 0,
    items: [{ id: 'p1', name: 'Basmati Rice', unit: 'kg', qty: 1, price: 120, lineTotal: 120 }],
    address: { house: '12', area: 'Test Colony', city: 'Hyderabad', pincode: '500001', landmark: 'Test market', note: 'Call before delivery' },
    scheduledDelivery: { date: scheduledDate, startTime: '10:00', endTime: '12:00', status: 'scheduled' },
    invoice: { number: 'INV-QA-1001' }
  });

  await page.route('**/api/orders**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/orders/' + orderId + '/invoice' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'content-disposition': 'attachment; filename="FreshWay-invoice-FW-QA-1001.pdf"' },
        body: '%PDF-1.4\n% FreshWay test invoice\n%%EOF'
      });
    }
    if (url.pathname === '/api/orders/' + orderId + '/request' && method === 'POST') {
      sentRequests.push(JSON.parse(request.postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request: { id: 'REQ-QA-1' } }) });
    }
    if (url.pathname === '/api/orders/' + orderId + '/reschedule' && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'Delivery date updated.' }) });
    }
    if (url.pathname === '/api/orders/' + orderId + '/cancel' && method === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'Cancelled' }) });
    }
    if (url.pathname === '/api/orders' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [sampleOrder()] }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test order endpoint.' }) });
  });

  const capture = async name => {
    await page.screenshot({
      path: 'test-results/visual-review/' + name + '.png',
      fullPage: false,
      animations: 'disabled'
    });
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => window.FreshWayNotifications.setCustomerId('e2e-customer-1'));
  await page.evaluate(() => window.setView('orders'));
  const orderCard = page.locator('[data-order-id="' + orderId + '"]');
  await expect(orderCard).toBeVisible();
  await expect(orderCard).toContainText('INV-QA-1001');
  await expect(orderCard).toContainText('Delivery fee');
  await expect(orderCard).toContainText('Test Colony');
  await capture('mobile-orders-populated');

  await orderCard.locator('[data-customer-order-open-request="issue"]').click();
  const requestPanel = orderCard.locator('[data-customer-order-request-panel]');
  await expect(requestPanel).toBeVisible();
  await expect(requestPanel).toContainText('Contact FreshWay about this order');
  await requestPanel.scrollIntoViewIfNeeded();
  await capture('mobile-order-help');
  await requestPanel.locator('textarea').fill('Please confirm the delivery.');
  await requestPanel.locator('[data-customer-order-submit-request]').click();
  await expect.poll(() => sentRequests.length).toBe(1);
  expect(sentRequests[0].reason).toBe('Please confirm the delivery.');
  expect(sentRequests[0].requestType).toBe('issue');

  await page.evaluate(() => window.setView('orders'));
  const refreshedCard = page.locator('[data-order-id="' + orderId + '"]');
  await expect(refreshedCard).toBeVisible();
  await refreshedCard.locator('[data-customer-order-reschedule]').click();
  const picker = refreshedCard.locator('[data-customer-reschedule-picker]');
  await expect(picker).toBeVisible();
  await picker.locator('[data-fw-date-choice="custom"]').click();
  await expect(picker.locator('[data-fw-delivery-date]')).toBeVisible();
  await picker.scrollIntoViewIfNeeded();
  await capture('mobile-order-reschedule');

  const downloadPromise = page.waitForEvent('download');
  await refreshedCard.locator('[data-download-invoice]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('FreshWay-invoice-FW-QA-1001.pdf');

  // Desktop review for a populated order and the actual confirmation presentation.
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.evaluate(() => window.setView('orders'));
  const desktopCard = page.locator('[data-order-id="' + orderId + '"]');
  await expect(desktopCard).toBeVisible();
  await capture('desktop-orders-populated');
  await desktopCard.locator('[data-customer-order-open-request="issue"]').click();
  const desktopRequestPanel = desktopCard.locator('[data-customer-order-request-panel]');
  await expect(desktopRequestPanel).toBeVisible();
  await desktopRequestPanel.scrollIntoViewIfNeeded();
  await capture('desktop-order-help');
  await page.evaluate(() => window.setView('orders'));
  const desktopRescheduleCard = page.locator('[data-order-id="' + orderId + '"]');
  await desktopRescheduleCard.locator('[data-customer-order-reschedule]').click();
  const desktopPicker = desktopRescheduleCard.locator('[data-customer-reschedule-picker]');
  await expect(desktopPicker).toBeVisible();
  await desktopPicker.scrollIntoViewIfNeeded();
  await capture('desktop-order-reschedule');

  const confirmation = {
    id: 'FW-QA-CONFIRM-1001',
    total: 150,
    pricingBreakdownKnown: true,
    itemsSubtotal: 120,
    deliveryFee: 30,
    couponCode: null,
    couponDiscount: 0,
    payment: 'Not Collected',
    status: 'New',
    deliveryPlan: 'Tomorrow'
  };
  await page.evaluate(order => window.showConfirmation(order), confirmation);
  await expect(page.locator('#confirmationView')).toBeVisible();
  await expect(page.locator('#confirmationView')).toContainText('FW-QA-CONFIRM-1001');
  await capture('desktop-order-confirmation');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile-order-confirmation');
  await page.locator('#confirmationOrders').click();
  await expect(page.locator('#ordersView')).toHaveClass(/active-view/);
  await page.evaluate(order => window.showConfirmation(order), confirmation);
  await page.locator('#confirmationHome').click();
  await expect(page.locator('#homeView')).toHaveClass(/active-view/);
});

test('checks the standalone account-deletion request flow on mobile and desktop', async ({ page }) => {
  let startCalls = 0;
  let verifyCalls = 0;
  await page.route('**/api/account-deletion/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/account-deletion/start' && request.method() === 'POST') {
      startCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'If an account matches, a verification code has been sent.' })
      });
    }
    if (url.pathname === '/api/account-deletion/verify' && request.method() === 'POST') {
      verifyCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Your deletion request has been submitted.', requestId: 'E2E-DELETE-001' })
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test deletion endpoint.' }) });
  });

  const capture = async name => {
    await page.screenshot({
      path: 'test-results/visual-review/' + name + '.png',
      fullPage: true,
      animations: 'disabled'
    });
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/delete-account.html');
  await expect(page.locator('h1')).toHaveText('Request account deletion');
  await expect(page.locator('#startForm')).toBeVisible();
  await capture('mobile-account-deletion-start');

  await page.locator('#phone').fill('123');
  await page.locator('#startForm button[type="submit"]').click();
  await expect(page.locator('#message')).toContainText('valid 10-digit');
  await capture('mobile-account-deletion-invalid-phone');

  await page.locator('#phone').fill('9876543210');
  await page.locator('#startForm button[type="submit"]').click();
  await expect(page.locator('#verifyForm')).toBeVisible();
  await expect(page.locator('#verifyForm')).toContainText('SMS verification code');
  await capture('mobile-account-deletion-verify');

  await page.locator('#code').fill('654321');
  await page.locator('#verifyForm button[type="submit"]').click();
  await expect(page.locator('#message')).toContainText('request has been submitted');
  await expect(page.locator('body')).toContainText('E2E-DELETE-001');
  await expect.poll(() => startCalls).toBe(1);
  await expect.poll(() => verifyCalls).toBe(1);
  await capture('mobile-account-deletion-success');

  await page.setViewportSize({ width: 1365, height: 900 });
  await page.reload();
  await expect(page.locator('#startForm')).toBeVisible();
  await capture('desktop-account-deletion-start');
  await page.locator('#phone').fill('9876543210');
  await page.locator('#startForm button[type="submit"]').click();
  await expect(page.locator('#verifyForm')).toBeVisible();
  await capture('desktop-account-deletion-verify');
});
