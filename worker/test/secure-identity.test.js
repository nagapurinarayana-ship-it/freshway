import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../src/passcode-auth.js';

const customer = { id: 'customer-1', name: '', phone: '', passcode_salt: null, passcode_hash: null };
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
              if (sql.includes('SELECT id,name,phone,passcode_salt,passcode_hash FROM customers WHERE phone')) return customer.phone === args[0] ? customer : null;
              if (sql.includes('SELECT phone FROM customers')) return customer.id === args[0] ? { phone: customer.phone } : null;
              if (sql.includes('SELECT id FROM customers')) return customer.id === args[0] ? { id: customer.id } : null;
              if (sql.includes('SELECT count,window_start FROM auth_rate_limits')) return { count: 1, window_start: Math.floor(Date.now() / 600000) * 600 };
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO customers') || sql.startsWith('UPDATE customers')) {
                if (sql.includes('passcode_salt')) { customer.phone = args[2]; customer.passcode_salt = args[3]; customer.passcode_hash = args[4]; customer.name = args[1] || ''; }
                else { customer.name = args[0] || ''; }
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

test('wrong passcode is rejected', async () => {
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', passcode: '000000' }) });
  assert.equal(response.status, 401);
});

test('passcode must be exactly six digits', async () => {
  const response = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Customer', phone: '9123456789', passcode: '12345' }) });
  assert.equal(response.status, 400);
});

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