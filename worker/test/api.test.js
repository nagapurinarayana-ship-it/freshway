import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../src/index.js';
import secureHandler from '../src/secure-index.js';
import adminHandler from '../src/admin-auth.js';

const env = {
  APP_ORIGIN: 'https://freshway-f32.pages.dev',
  ADMIN_TOKEN: 'fixture-admin',
  CUSTOMER_SESSION_SECRET: 'fixture-customer-session',
  ADMIN_SESSION_SECRET: 'fixture-admin-session',
  DB: {
    prepare() { throw new Error('DB should not be touched by this test'); }
  }
};
const rateRows = new Map();
const adminEnv = {
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

async function request(path, options = {}, target = handler, targetEnv = env) { return target.fetch(new Request(`https://api.example.test${path}`, options), targetEnv, {}); }
async function jsonResponse(response) { return response.json(); }

test('health endpoint returns a stable success response', async () => { const response = await request('/api/health'); assert.equal(response.status, 200); assert.deepEqual(await jsonResponse(response), { ok: true, service: 'freshway-api' }); assert.equal(response.headers.get('access-control-allow-origin'), env.APP_ORIGIN); });
test('unknown routes return 404 JSON', async () => { const response = await request('/api/does-not-exist'); assert.equal(response.status, 404); assert.equal((await jsonResponse(response)).error, 'Not found'); });
test('admin endpoints reject missing credentials', async () => { const response = await request('/api/admin/orders'); assert.equal(response.status, 401); assert.equal((await jsonResponse(response)).error, 'Unauthorized'); });
test('admin endpoints reject an invalid bearer token', async () => { const response = await request('/api/admin/orders', { headers: { Authorization: 'Bearer wrong-token' } }); assert.equal(response.status, 401); });
test('customer order listing is rejected when customer id is missing', async () => { const response = await request('/api/orders'); assert.equal(response.status, 400); assert.match((await jsonResponse(response)).error, /customer id is required/i); });
test('order creation validates required customer details before database access', async () => { const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', items: [] }) }); assert.equal(response.status, 400); assert.match((await jsonResponse(response)).error, /customer details are required/i); });
test('order creation rejects malformed quantities before database access', async () => { const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', customer: { name: 'Test Customer', phone: '9876543210' }, address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' }, items: [{ id: 'apple', qty: 0 }] }) }); assert.equal(response.status, 400); assert.match((await jsonResponse(response)).error, /invalid cart item/i); });
test('CORS preflight exposes credential support on the secure customer wrapper', async () => { const response = await request('/api/auth/session', { method: 'OPTIONS' }, secureHandler); assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), env.APP_ORIGIN); assert.equal(response.headers.get('access-control-allow-credentials'), 'true'); });
test('secure customer wrapper rejects an unexpected Origin', async () => { const response = await request('/api/auth/session', { headers: { Origin: 'https://evil.example' } }, secureHandler); assert.equal(response.status, 403); assert.match((await jsonResponse(response)).error, /origin not allowed/i); });
test('customer session endpoint rejects missing or invalid sessions', async () => { const response = await request('/api/auth/session', {}, secureHandler); assert.equal(response.status, 401); assert.match((await jsonResponse(response)).error, /authentication required/i); });
test('customer session endpoint rejects malformed multi-segment cookies', async () => { const response = await request('/api/auth/session', { headers: { Cookie: 'freshway-customer-session=bad.signature.extra' } }, secureHandler); assert.equal(response.status, 401); });
test('customer order POST is rejected without a matching signed session', async () => { const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', customer: { name: 'Test Customer', phone: '9876543210' }, address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' }, items: [{ id: 'apple', qty: 1 }] }) }, secureHandler); assert.equal(response.status, 401); });
test('OTP start validates Indian mobile numbers before calling Twilio', async () => { const response = await request('/api/auth/otp/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '123' }) }, secureHandler); assert.equal(response.status, 400); assert.match((await jsonResponse(response)).error, /valid 10-digit Indian mobile/i); });
test('OTP verification validates the submitted code before calling Twilio', async () => { const response = await request('/api/auth/otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', code: 'abc' }) }, secureHandler); assert.equal(response.status, 400); assert.match((await jsonResponse(response)).error, /mobile number and OTP/i); });
test('admin session wrapper rejects an unexpected Origin', async () => { const response = await request('/api/admin/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv); assert.equal(response.status, 403); assert.match((await jsonResponse(response)).error, /origin not allowed/i); });
test('admin session wrapper rejects protected requests without its cookie', async () => { const response = await request('/api/admin/orders', {}, adminHandler, adminEnv); assert.equal(response.status, 401); });
test('admin login rejects an incorrect token', async () => { const response = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong-token' }) }, adminHandler, adminEnv); assert.equal(response.status, 401); });
test('admin login issues an expiring HttpOnly session cookie', async () => { const response = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv); assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie') || ''; assert.match(cookie, /freshway-admin-session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Max-Age=28800/); assert.match(cookie, /SameSite=Lax/); });
test('admin logout clears the session cookie', async () => { const response = await request('/api/admin/logout', { method: 'POST' }, adminHandler, adminEnv); assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/); });
test('admin session cookie rejects extra token segments', async () => { const login = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv); const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; const response = await request('/api/admin/orders', { headers: { Cookie: `${cookie}.extra` } }, adminHandler, adminEnv); assert.equal(response.status, 401); });