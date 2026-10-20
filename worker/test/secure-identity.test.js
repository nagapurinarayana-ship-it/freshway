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

test('customer can create a 6-digit passcode account', async () => {
  const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Customer', phone: '9876543210', passcode: '246810' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /freshway-customer-session=/);
  assert.equal(customer.phone, '919876543210');
  assert.equal(customer.name, 'Test Customer');
  assert.notEqual(customer.passcode_hash, '246810');
  assert.match(customer.passcode_hash || '', /^[0-9a-f]{64}$/);
});

test('customer can log in again with mobile number and passcode', async () => {
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', passcode: '246810' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).customerId, 'customer-1');
});

test('customer can log in with +91-prefixed mobile number after normalization', async () => {
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+91 9876543210', passcode: '246810' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).customerId, 'customer-1');
});

test('wrong passcode is rejected', async () => {
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', passcode: '000000' }) });
  assert.equal(response.status, 401);
});

test('passcode must be exactly six digits', async () => {
  const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Customer', phone: '9123456789', passcode: '12345' }) });
  assert.equal(response.status, 400);
});

test('order identity uses the registered account phone and keeps delivery contact in the snapshot', () => {
  const source = readFileSource();
  assert.ok(source.includes("const deliveryPhone = cleanPhone(payload.address?.deliveryPhone || payload.customer?.phone)"));
  assert.ok(source.includes("customer: { ...(payload.customer || {}), phone: registeredPhone }"));
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
  assert.notEqual(response.status, 409);
  assert.equal(customer.phone, registeredPhone);
});

test('customer registration update keeps the registered mobile immutable', async () => {
  const registeredPhone = customer.phone;
  const response = await request('/api/customers/register', { method: 'POST', headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'customer-1', name: 'Updated Delivery Name', phone: '9123456789' }) });
  assert.equal(response.status, 200);
  assert.equal(customer.phone, registeredPhone);
});

test('an already registered mobile cannot create a second account', async () => {
  const previousId = customer.id, previousHash = customer.passcode_hash;
  const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Second Account', phone: '9876543210', passcode: '112233' }) });
  assert.equal(response.status, 409);
  assert.equal(customer.id, previousId);
  assert.equal(customer.passcode_hash, previousHash);
});

test('forgot passcode fails safely when SMS verification is not configured', async () => {
  const response = await request('/api/auth/passcode-reset/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210' }) });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /temporarily unavailable/i);
});

test('forgot passcode sends SMS verification without exposing whether a number is registered', async t => {
  const configured = {
    ...env,
    TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
    TWILIO_AUTH_TOKEN: 'test-auth-token',
    TWILIO_VERIFY_SERVICE_SID: 'VA' + 'b'.repeat(32)
  };
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /\/Verifications$/);
    assert.equal(options.method, 'POST');
    assert.match(options.headers.authorization, /^Basic /);
    assert.ok(options.body.includes('To=%2B919876543210'));
    assert.ok(options.body.includes('Channel=sms'));
    return Response.json({ status: 'pending' }, { status: 201 });
  });
  const response = await request('/api/auth/passcode-reset/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210' })
  }, configured);
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /If this mobile is registered/i);
  assert.equal(mock.mock.callCount(), 1);
});

test('approved SMS reset changes passcode and invalidates old sessions', async t => {
  const oldHash = customer.passcode_hash;
  const configured = {
    ...env,
    TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
    TWILIO_AUTH_TOKEN: 'test-auth-token',
    TWILIO_VERIFY_SERVICE_SID: 'VA' + 'b'.repeat(32)
  };
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /\/VerificationCheck$/);
    assert.match(options.body, /Code=654321/);
    return Response.json({ status: 'approved' }, { status: 200 });
  });
  const response = await request('/api/auth/passcode-reset/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', code: '654321', passcode: '135790' })
  }, configured);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.customerId, 'customer-1');
  assert.equal(payload.registeredPhone, '919876543210');
  assert.equal(customer.phone, '919876543210');
  assert.notEqual(customer.passcode_hash, oldHash);
  assert.equal(customer.auth_version, 1);
  assert.equal(mock.mock.callCount(), 1);
  const oldSession = await request('/api/auth/session', { method: 'GET', headers: { Cookie: sessionCookie() } }, configured);
  assert.equal(oldSession.status, 401);
  const oldLogin = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', passcode: '246810' }) }, configured);
  assert.equal(oldLogin.status, 401);
  const newLogin = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', passcode: '135790' }) }, configured);
  assert.equal(newLogin.status, 200);
});
