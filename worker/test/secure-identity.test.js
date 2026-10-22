import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../src/passcode-auth.js';

const customer = { id: 'customer-1', name: '', phone: '919876543210', passcode_salt: null, passcode_hash: null, auth_version: 0 };
const env = {
  APP_ORIGIN: 'https://freshway-f32.pages.dev',
  CUSTOMER_SESSION_SECRET: 'fixture-customer-session',
  DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('SELECT id,name,phone,passcode_salt,passcode_hash')) return customer.phone === args[0] ? customer : null;
              if (sql.includes('SELECT id,name,phone FROM customers')) return customer.id === args[0] ? customer : null;
              if (sql.includes('SELECT auth_version FROM customers')) return customer.id === args[0] ? { auth_version: customer.auth_version || 0 } : null;
              if (sql.includes('SELECT id,name,phone,passcode_salt,passcode_hash FROM customers WHERE phone')) return customer.phone === args[0] ? customer : null;
              if (sql.includes('SELECT phone FROM customers')) return customer.id === args[0] ? { phone: customer.phone } : null;
              if (sql.includes('SELECT id FROM customers')) return customer.id === args[0] ? { id: customer.id } : null;
              if (sql.includes('SELECT count,window_start FROM auth_rate_limits')) return { count: 1, window_start: Math.floor(Date.now() / 600000) * 600 };
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO customers')) {
                customer.id = args[0]; customer.name = args[1] || ''; customer.phone = args[2];
                customer.passcode_salt = args[3]; customer.passcode_hash = args[4]; customer.auth_version = 0;
              } else if (sql.startsWith('UPDATE customers SET passcode_salt=')) {
                customer.passcode_salt = args[0]; customer.passcode_hash = args[1];
                customer.auth_version = Number(customer.auth_version || 0) + 1;
              } else if (sql.startsWith('UPDATE customers SET whatsapp_opt_in=')) {
                customer.whatsapp_opt_in = args[0];
              }
              return { meta: { changes: 1 } };
            },
            async all() { return { results: [] }; }
          };
        }
      };
    }
  }
};
function sessionCookie(customerId = 'customer-1') {
  const issued = Math.floor(Date.now() / 1000); const payload = `${customerId}.${issued}`; const encoded = Buffer.from(payload).toString('base64url'); const signature = crypto.createHmac('sha256', env.CUSTOMER_SESSION_SECRET).update(payload).digest('hex'); return `freshway-customer-session=${encoded}.${signature}`;
}
async function request(path, options = {}, requestEnv = env) { return handler.fetch(new Request(`https://api.example.test${path}`, options), requestEnv, {}); }

test('customer logout clears the HttpOnly session cookie', async () => {
  const response = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /freshway-customer-session=; Max-Age=0/);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
});

test('legacy passcode login, registration, and recovery endpoints are disabled', async () => {
  const requests = [
    ['/api/auth/register', { name: 'Test Customer', phone: '9876543210', passcode: '246810' }],
    ['/api/auth/login', { phone: '9876543210', passcode: '246810' }],
    ['/api/auth/passcode-reset/start', { phone: '9876543210' }],
    ['/api/auth/passcode-reset/complete', { phone: '9876543210', code: '123456', passcode: '135790' }]
  ];
  for (const [path, body] of requests) {
    const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 410, path + ' must require passwordless WhatsApp OTP');
    assert.match((await response.json()).error, /WhatsApp OTP/i);
  }
});

test('order identity uses the registered account phone and keeps delivery contact in the snapshot', () => {
  const source = readFileSource();
  assert.ok(source.includes("const deliveryPhone = cleanPhone(payload.address?.deliveryPhone || payload.customer?.phone)"));
  assert.ok(source.includes("customer: { ...(payload.customer || {}), phone: registeredPhone.slice(2) }"), "the legacy order writer must receive 10 digits while stored identity remains canonical");
  assert.ok(source.includes('deliveryPhone:') && source.includes('registeredPhone'), 'delivery mobile must be stored separately from registered identity');
  assert.ok(source.includes("bind(registeredPhone, String(result.id), sessionId).run()"));
  assert.equal(source.includes("bind(`91${deliveryPhone}`, String(result.id), sessionId).run()"), false);
});

function readFileSource() {
  return readFileSync(new URL('../src/passcode-auth.js', import.meta.url), 'utf8');
}

test('customer checkout keeps delivery mobile separate from registered mobile', async () => {
  const registeredPhone = customer.phone;
  const response = await request('/api/orders', { method: 'POST', headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'customer-1', customer: { name: 'Test Customer', phone: '9123456789' }, address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' }, items: [{ id: 'apple', qty: 1 }] }) });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.match(result.error, /One or more products are no longer available/i,
    'valid registered account phone must pass the legacy ten-digit check and reach product validation');
  assert.equal(customer.phone, registeredPhone);
});

test('customer registration update keeps the registered mobile immutable', async () => {
  const registeredPhone = customer.phone;
  const response = await request('/api/customers/register', { method: 'POST', headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'customer-1', name: 'Updated Delivery Name', phone: '9123456789' }) });
  assert.equal(response.status, 200);
  assert.equal(customer.phone, registeredPhone);
});

