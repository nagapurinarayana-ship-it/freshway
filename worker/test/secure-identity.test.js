import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import secureHandler from '../src/secure-index.js';

const env = {
  APP_ORIGIN: 'https://freshway-f32.pages.dev',
  CUSTOMER_SESSION_SECRET: 'fixture-customer-session',
  DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('SELECT phone FROM customers')) return { phone: '919876543210' };
              if (sql.includes('SELECT id FROM customers')) return { id: args[0] || 'customer-1' };
              return null;
            },
            async run() { return { meta: { changes: 1 } }; },
            async all() { return { results: [] }; }
          };
        }
      };
    }
  }
};

function sessionCookie(customerId = 'customer-1') {
  const issued = Math.floor(Date.now() / 1000);
  const payload = `${customerId}.${issued}`;
  const encoded = Buffer.from(payload).toString('base64url');
  const signature = crypto.createHmac('sha256', env.CUSTOMER_SESSION_SECRET).update(payload).digest('hex');
  return `freshway-customer-session=${encoded}.${signature}`;
}

async function request(path, options = {}, requestEnv = env) {
  return secureHandler.fetch(new Request(`https://api.example.test${path}`, options), requestEnv, {});
}

test('customer logout clears the HttpOnly session cookie', async () => {
  const response = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /freshway-customer-session=; Max-Age=0/);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') || '', /SameSite=Lax/);
});

test('customer checkout cannot replace the verified mobile number', async () => {
  const response = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: 'customer-1',
      customer: { name: 'Test Customer', phone: '9123456789' },
      address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' },
      items: [{ id: 'apple', qty: 1 }]
    })
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /verified customer session/i);
});

test('customer checkout accepts the verified mobile number', async () => {
  const response = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: 'customer-1',
      customer: { name: 'Test Customer', phone: '9876543210' },
      address: { house: '1', area: 'Main Road', city: 'Hyderabad', pincode: '500001' },
      items: [{ id: 'apple', qty: 1 }]
    })
  });
  assert.notEqual(response.status, 409);
});

test('customer registration cannot replace the verified mobile number', async () => {
  const response = await request('/api/customers/register', {
    method: 'POST',
    headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'customer-1', name: 'Test Customer', phone: '9123456789' })
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /verified customer session/i);
});

test('customer registration accepts the verified mobile number', async () => {
  const response = await request('/api/customers/register', {
    method: 'POST',
    headers: { Cookie: sessionCookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'customer-1', name: 'Test Customer', phone: '9876543210' })
  });
  assert.notEqual(response.status, 409);
});

test('local mock OTP is accepted only on localhost', async () => {
  const localEnv = { ...env, APP_ORIGIN: 'http://localhost:8787', OTP_PROVIDER: 'mock' };
  const start = await request('/api/auth/otp/start', {
    method: 'POST',
    headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210' })
  }, localEnv);
  assert.equal(start.status, 200);
  assert.equal((await start.json()).testCode, '123456');

  const verify = await request('/api/auth/otp/verify', {
    method: 'POST',
    headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', code: '123456' })
  }, localEnv);
  assert.equal(verify.status, 200);
  assert.match(verify.headers.get('set-cookie') || '', /freshway-customer-session=/);
});

test('mock OTP is blocked on the production origin', async () => {
  const mockProductionEnv = { ...env, APP_ORIGIN: 'https://freshway-f32.pages.dev', OTP_PROVIDER: 'mock' };
  const response = await request('/api/auth/otp/start', {
    method: 'POST',
    headers: { Origin: 'https://freshway-f32.pages.dev', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210' })
  }, mockProductionEnv);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /local development origins/i);
});

test('wrong local mock OTP is rejected', async () => {
  const localEnv = { ...env, APP_ORIGIN: 'http://localhost:8787', OTP_PROVIDER: 'mock' };
  const response = await request('/api/auth/otp/verify', {
    method: 'POST',
    headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210', code: '000000' })
  }, localEnv);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /incorrect or expired otp/i);
});

test('unknown OTP providers fail closed', async () => {
  const unknownEnv = { ...env, APP_ORIGIN: 'http://localhost:8787', OTP_PROVIDER: 'unknown' };
  const response = await request('/api/auth/otp/start', {
    method: 'POST',
    headers: { Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9876543210' })
  }, unknownEnv);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /unsupported otp provider/i);
});
