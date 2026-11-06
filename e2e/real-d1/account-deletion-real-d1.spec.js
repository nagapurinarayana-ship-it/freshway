import { test, expect } from '@playwright/test';

const origin = 'http://localhost:4173';
const workerOrigin = 'http://localhost:8787';

function cookieFrom(response, name) {
  const header = response.headers()['set-cookie'] || '';
  const match = header.match(new RegExp(name + '=([^;,\\s]+)'));
  expect(match, name + ' must be set by the real Worker').toBeTruthy();
  return match[1];
}

test('account deletion redacts operational records, revokes access and preserves the issued invoice in isolated D1', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const phone = '9' + String(Date.now()).slice(-9);
    const passcode = String(100000 + (Date.now() % 900000));
    const registration = await context.request.post(workerOrigin + '/api/auth/register', {
      headers: { Origin: origin },
      data: { name: 'Privacy D1 E2E Customer', phone, passcode }
    });
    expect(registration.status()).toBe(200);
    const customer = await registration.json();
    expect(customer.customerId).toBeTruthy();
    const customerCookie = cookieFrom(registration, 'freshway-customer-session');
    await context.addCookies([{
      name: 'freshway-customer-session', value: customerCookie, url: workerOrigin,
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
        customer: { name: 'Privacy D1 E2E Customer', phone },
        address: {
          recipientName: 'Privacy D1 E2E Recipient',
          house: '42', area: 'Privacy Test Colony', city: 'Hyderabad', pincode: '500072',
          latitude: 17.385044, longitude: 78.486671, deliveryPhone: phone
        },
        storeId: 'store-d1', preferredDeliveryDate: deliveryDate,
        items: [{ id: 'oil-d1', qty: 1 }]
      }
    });
    expect(created.status()).toBe(201);
    const order = await created.json();
    expect(order.assignedStoreId).toBe('store-d1');

    const ownerLogin = await context.request.post(workerOrigin + '/api/admin/login', {
      headers: { Origin: origin }, data: { token: 'isolated-admin-token' }
    });
    expect(ownerLogin.status()).toBe(200);
    const ownerCookie = cookieFrom(ownerLogin, '__Host-freshway-admin-session');
    const ownerHeaders = { Origin: origin, 'X-FreshWay-Admin-Session': ownerCookie };

    for (const status of ['Confirmed', 'Processing', 'Ready', 'Out for Delivery']) {
      const response = await context.request.patch(workerOrigin + '/api/admin/orders/' + encodeURIComponent(order.id), {
        headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
        data: { status }
      });
      expect(response.status(), 'Owner can progress order to ' + status).toBe(200);
      const body = await response.json();
      if (status === 'Out for Delivery') expect(body.invoice?.number).toBeTruthy();
    }

    const invoiceBefore = await context.request.get(workerOrigin + '/api/admin/orders/' + encodeURIComponent(order.id) + '/invoice', {
      headers: ownerHeaders
    });
    expect(invoiceBefore.status()).toBe(200);
    expect(invoiceBefore.headers()['content-type']).toContain('application/pdf');
    const invoiceBeforeBytes = Buffer.from(await invoiceBefore.body());
    expect(invoiceBeforeBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(invoiceBeforeBytes.length).toBeGreaterThan(500);

    const deletionRequest = await context.request.post(workerOrigin + '/api/account-deletion/request', {
      headers: { Origin: origin, 'Content-Type': 'application/json' }, data: {}
    });
    expect(deletionRequest.status()).toBe(202);
    const deletion = await deletionRequest.json();
    expect(deletion.requestId).toBeTruthy();
    expect(deletion.status).toBe('pending');

    const reviewed = await context.request.patch(workerOrigin + '/api/admin/account-deletion-requests/' + encodeURIComponent(deletion.requestId), {
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      data: { status: 'in_review', adminNote: 'Reviewed the verified request.' }
    });
    expect(reviewed.status()).toBe(200);

    const completed = await context.request.patch(workerOrigin + '/api/admin/account-deletion-requests/' + encodeURIComponent(deletion.requestId), {
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      data: { status: 'completed', adminNote: 'Buyer invoice snapshot retained under the approved accounting retention policy.' }
    });
    expect(completed.status()).toBe(200);
    expect(await completed.json()).toMatchObject({ ok: true, status: 'completed', alreadyCompleted: false });

    const sessionAfter = await context.request.get(workerOrigin + '/api/auth/session', { headers: { Origin: origin } });
    expect(sessionAfter.status()).toBe(401);
    const addressesAfter = await context.request.get(workerOrigin + '/api/addresses', { headers: { Origin: origin } });
    expect(addressesAfter.status()).toBe(401);
    const customerInvoiceAfter = await context.request.get(workerOrigin + '/api/orders/' + encodeURIComponent(order.id) + '/invoice', {
      headers: { Origin: origin }
    });
    expect(customerInvoiceAfter.status()).toBe(401);

    const ownerOrders = await context.request.get(workerOrigin + '/api/admin/orders?search=' + encodeURIComponent(order.id) + '&limit=1&testOrders=0', {
      headers: ownerHeaders
    });
    expect(ownerOrders.status()).toBe(200);
    const saved = (await ownerOrders.json()).orders.find(item => item.id === order.id);
    expect(saved).toBeTruthy();
    expect(saved.customerName).toBe('Deleted customer');
    expect(saved.customerPhone).toBe('');
    expect(saved.invoice?.number).toBeTruthy();

    const invoiceAfter = await context.request.get(workerOrigin + '/api/admin/orders/' + encodeURIComponent(order.id) + '/invoice', {
      headers: ownerHeaders
    });
    expect(invoiceAfter.status()).toBe(200);
    const invoiceAfterBytes = Buffer.from(await invoiceAfter.body());
    expect(invoiceAfterBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(invoiceAfterBytes.length).toBeGreaterThan(500);

    const queue = await context.request.get(workerOrigin + '/api/admin/account-deletion-requests', { headers: ownerHeaders });
    expect(queue.status()).toBe(200);
    const queueData = await queue.json();
    expect(queueData.summary.completed).toBe(1);
    expect(queueData.requests.some(item => item.id === deletion.requestId)).toBe(false);
  } finally {
    await context.close();
  }
});
