import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import handler from '../src/index.js';
import passcodeHandler from '../src/passcode-auth.js';
import adminHandler from '../src/admin-auth.js';
import { handleAddress } from '../src/address-api.js';

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

test('customer registration requires a name and 6-digit passcode', async () => {
  const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', passcode: '123456' }) }, passcodeHandler, authEnv);
  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /name/i);
});

test('customer session endpoint rejects missing sessions', async () => {
  const response = await request('/api/auth/session', {}, passcodeHandler, authEnv);
  assert.equal(response.status, 401);
  assert.match((await jsonResponse(response)).error, /authentication required/i);
});

test('customer logout clears the cross-site session cookie securely', async () => {
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

test('admin login issues an expiring HttpOnly same-site session cookie', async () => {
  const response = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /__Host-freshway-admin-session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=28800/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test('admin logout clears the session cookie', async () => {
  const response = await request('/api/admin/logout', { method: 'POST' }, adminHandler, adminEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.match(response.headers.get('set-cookie') || '', /SameSite=Lax/);
});

test('admin session cookie rejects extra token segments', async () => {
  const login = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-admin' }) }, adminHandler, adminEnv);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const response = await request('/api/admin/orders', { headers: { Cookie: `${cookie}.extra` } }, adminHandler, adminEnv);
  assert.equal(response.status, 401);
});

test('customer auth UI uses mobile, name for registration, plus 6-digit passcode and contains no OTP flow', () => {
  const root = fileURLToPath(new URL('../../notifications.js', import.meta.url));
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  const notifications = readFileSync(root, 'utf8');
  assert.doesNotMatch(notifications, /otp\/start|otp\/verify|Twilio|one-time password/i);
  assert.match(notifications, /passcodeName/);
  assert.match(notifications, /passcodePhone/);
  assert.match(notifications, /passcodeValue/);
  assert.match(notifications, /6-digit passcode/);
  assert.match(html, /id="signOutBtn"/);
});


test('customer auth UI trims +91 to the remaining 10 digits and keeps passcode-only auth', () => {
  const root = fileURLToPath(new URL('../../notifications.js', import.meta.url));
  const notifications = readFileSync(root, 'utf8');
  assert.match(notifications, /normalizeAuthPhone=value=>/);
  assert.match(notifications, /digits\.length===12&&digits\.startsWith\('91'\)/);
  assert.match(notifications, /maxlength="15" pattern="\[0-9\]\{10\}" autocomplete="tel"/);
  assert.match(notifications, /phoneEl\.addEventListener\('blur'/);
  assert.doesNotMatch(notifications, /otp\/start|otp\/verify|Twilio|one-time password/i);
});

test('customer checkout address UI keeps map attribution inside the map and avoids duplicate phone helper markup', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  const styles = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8');
  const helper = 'Can be different from your registered mobile number.';
  const phoneSection = html.match(/<label>Delivery contact number[\s\S]*?<\/label>/)?.[0] || '';
  assert.equal(phoneSection.includes(helper), false);
  assert.match(styles, /\.address-map\{position:relative;z-index:0;isolation:isolate\}/);
  assert.match(styles, /\.whatsapp-opt\{display:grid!important;grid-template-columns:24px 28px minmax\(0,1fr\)/);
});



test('checkout delivery mobile preserves 10 digits and trims only a 91 prefix', () => {
  const checkout = readFileSync(fileURLToPath(new URL('../../frontend/customer/checkout.js', import.meta.url)), 'utf8');
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
  assert.ok(checkout.includes("if(digits.length===10)return digits"));
  assert.ok(checkout.includes("if(digits.length===12&&digits.startsWith('91'))return digits.slice(2)"));
  assert.ok(html.includes('pattern="(?:[0-9]{10}|\\+?91[\\s-]?[0-9]{10})"'));
});

test('saved-address API accepts plain 10-digit and +91 delivery mobiles', () => {
  const addressApi = readFileSync(fileURLToPath(new URL('../src/address-api.js', import.meta.url)), 'utf8');
  assert.ok(addressApi.includes("if (digits.length === 10) return"));
  assert.ok(addressApi.includes("if (digits.length === 12 && digits.startsWith('91')) return digits"));
});

test('saved-address deletion soft-deletes rows so order foreign keys remain valid', async () => {
  const queries = [];
  const deleteEnv = {
    ...env,
    DB: {
      prepare(sql) {
        queries.push(sql);
        return {
          bind(...args) {
            return {
              async first() {
                if (/SELECT \* FROM addresses WHERE id=\?/.test(sql)) {
                  return { id: 42, customer_id: 'customer-1', is_default: 1 };
                }
                return null;
              },
              async all() {
                return { results: [] };
              },
              async run() {
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };

  const response = await handleAddress(
    new Request('https://api.example.test/api/addresses/42', { method: 'DELETE' }),
    deleteEnv,
    'customer-1',
    'delete'
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, addresses: [] });
  assert.ok(queries.some(sql => /UPDATE addresses SET is_default=0,deleted_at=CURRENT_TIMESTAMP/.test(sql)));
  assert.ok(queries.every(sql => !/DELETE FROM addresses WHERE/.test(sql)));
  assert.ok(queries.some(sql => /deleted_at IS NULL/.test(sql)));
});
