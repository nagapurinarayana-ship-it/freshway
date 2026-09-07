import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import handler from '../src/index.js';
import passcodeHandler from '../src/passcode-auth.js';
import adminHandler from '../src/admin-auth.js';

const env = {
  APP_ORIGIN: 'https://freshway-f32.pages.dev',
  ADMIN_TOKEN: 'fixture-admin',
  CUSTOMER_SESSION_SECRET: 'fixture-customer-session',
  ADMIN_SESSION_SECRET: 'fixture-admin-session',
  DB: { prepare() { throw new Error('DB should not be touched by this test'); } }
};
const rateRows = new Map();
const authEnv = {
  ...env,
  DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.startsWith('INSERT INTO auth_rate_limits')) {
                const [key, windowStart] = args;
                const previous = rateRows.get(key);
                rateRows.set(key, { window_start: windowStart, count: previous?.window_start === windowStart ? previous.count + 1 : 1 });
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.startsWith('SELECT count,window_start')) return rateRows.get(args[0]) || null;
              return null;
            }
          };
        }
      };
    }
  }
};
const adminEnv = authEnv;

async function request(path, options = {}, target = handler, targetEnv = env) {
  return target.fetch(new Request(`https://api.example.test${path}`, options), targetEnv, {});
}
async function jsonResponse(response) { return response.json(); }

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
  const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', items: [] }) });
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /customer details are required/i);
});

test('order creation rejects malformed quantities before database access', async () => {
  const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', customer: { name: 'Test Customer', phone: '9876543210' }, address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' }, items: [{ id: 'apple', qty: 0 }] }) });
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /invalid cart item/i);
});

test('customer auth preflight exposes credential support', async () => {
  const response = await request('/api/auth/session', { method: 'OPTIONS' }, passcodeHandler, authEnv);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), env.APP_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('customer auth rejects an unexpected Origin', async () => {
  const response = await request('/api/auth/session', { headers: { Origin: 'https://evil.example' } }, passcodeHandler, authEnv);
  assert.equal(response.status, 403);
  assert.match((await jsonResponse(response)).error, /origin not allowed/i);
});

test('customer session endpoint rejects missing sessions', async () => {
  const response = await request('/api/auth/session', {}, passcodeHandler, authEnv);
  assert.equal(response.status, 401);
  assert.match((await jsonResponse(response)).error, /authentication required/i);
});

test('customer logout clears the session cookie', async () => {
  const response = await request('/api/auth/logout', { method: 'POST' }, passcodeHandler, authEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await jsonResponse(response), { ok: true });
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /freshway-customer-session=/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('customer order POST is rejected without a matching signed session', async () => {
  const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', customer: { name: 'Test Customer', phone: '9876543210' }, address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' }, items: [{ id: 'apple', qty: 1 }] }) }, passcodeHandler, authEnv);
  assert.equal(response.status, 401);
});

test('admin session wrapper rejects an unexpected Origin', async () => {
  const response = await request('/api/admin/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv);
  assert.equal(response.status, 403);
  assert.match((await jsonResponse(response)).error, /origin not allowed/i);
});

test('admin session wrapper rejects protected requests without its cookie', async () => {
  const response = await request('/api/admin/orders', {}, adminHandler, adminEnv);
  assert.equal(response.status, 401);
});

test('admin login rejects an incorrect token', async () => {
  const response = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong-token' }) }, adminHandler, adminEnv);
  assert.equal(response.status, 401);
});

test('admin login issues an expiring HttpOnly session cookie', async () => {
  const response = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /freshway-admin-session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=28800/);
  assert.match(cookie, /SameSite=Lax/);
});

test('admin logout clears the session cookie', async () => {
  const response = await request('/api/admin/logout', { method: 'POST' }, adminHandler, adminEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
});

test('admin session cookie rejects extra token segments', async () => {
  const login = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const response = await request('/api/admin/orders', { headers: { Cookie: `${cookie}.extra` } }, adminHandler, adminEnv);
  assert.equal(response.status, 401);
});

test('customer auth UI uses mobile plus 6-digit passcode and contains no OTP flow', () => {
  const root = fileURLToPath(new URL('../../notifications.js', import.meta.url));
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  const notifications = readFileSync(root, 'utf8');
  assert.doesNotMatch(notifications, /otp\/start|otp\/verify|Twilio|one-time password/i);
  assert.match(notifications, /passcodePhone/);
  assert.match(notifications, /passcodeValue/);
  assert.match(notifications, /6-digit passcode/);
  assert.match(html, /id="signOutBtn"/);
});
