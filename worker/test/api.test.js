import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../src/index.js';
import secureHandler from '../src/secure-index.js';

const env = {
  APP_ORIGIN: 'https://freshway-f32.pages.dev',
  ADMIN_TOKEN: 'test-admin-token',
  CUSTOMER_SESSION_SECRET: 'test-customer-session-secret',
  DB: {
    prepare() { throw new Error('DB should not be touched by this test'); }
  }
};

async function request(path, options = {}, target = handler) {
  const request = new Request(`https://api.example.test${path}`, options);
  return target.fetch(request, env, {});
}

async function jsonResponse(response) {
  return response.json();
}

test('health endpoint returns a stable success response', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonResponse(response), { ok: true, service: 'freshway-api' });
  assert.equal(response.headers.get('access-control-allow-origin'), env.APP_ORIGIN);
});

test('unknown routes return 404 JSON', async () => {
  const response = await request('/api/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal((await jsonResponse(response)).error, 'Not found');
});

test('admin endpoints reject missing credentials', async () => {
  const response = await request('/api/admin/orders');
  assert.equal(response.status, 401);
  assert.equal((await jsonResponse(response)).error, 'Unauthorized');
});

test('admin endpoints reject an invalid bearer token', async () => {
  const response = await request('/api/admin/orders', { headers: { Authorization: 'Bearer wrong-token' } });
  assert.equal(response.status, 401);
});

test('customer order listing is rejected when customer id is missing', async () => {
  const response = await request('/api/orders');
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /customer id is required/i);
});

test('order creation validates required customer details before database access', async () => {
  const response = await request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: 'customer-1', items: [] })
  });
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /customer details are required/i);
});

test('order creation rejects malformed quantities before database access', async () => {
  const response = await request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: 'customer-1',
      customer: { name: 'Test Customer', phone: '9876543210' },
      address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' },
      items: [{ id: 'apple', qty: 0 }]
    })
  });
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /invalid cart item/i);
});

test('CORS preflight exposes credential support on the secure wrapper', async () => {
  const response = await request('/api/auth/session', { method: 'OPTIONS' }, secureHandler);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), env.APP_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('customer session endpoint rejects missing or invalid sessions', async () => {
  const response = await request('/api/auth/session', {}, secureHandler);
  assert.equal(response.status, 401);
  assert.match((await jsonResponse(response)).error, /authentication required/i);
});

test('OTP start validates Indian mobile numbers before calling Twilio', async () => {
  const response = await request('/api/auth/otp/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '123' })
  }, secureHandler);
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /valid 10-digit Indian mobile/i);
});

test('OTP verification validates the submitted code before calling Twilio', async () => {
  const response = await request('/api/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', code: 'abc' })
  }, secureHandler);
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /mobile number and OTP/i);
});
