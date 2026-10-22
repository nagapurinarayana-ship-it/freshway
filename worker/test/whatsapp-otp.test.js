import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../src/passcode-auth.js';

const secret = 'test-customer-session-secret';
function createEnv(initialCustomer = null) {
  const customers = new Map();
  if (initialCustomer) customers.set(initialCustomer.phone, { ...initialCustomer });
  const challenges = new Map();
  const limits = new Map();
  const env = {
    APP_ORIGIN: 'https://fwcoldpressed.in',
    CUSTOMER_SESSION_SECRET: secret,
    WHATSAPP_ACCESS_TOKEN: 'test-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_GRAPH_VERSION: 'v23.0',
    WHATSAPP_AUTH_TEMPLATE_NAME: 'freshway_login_otp',
    WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'en_US',
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id,name,phone,passcode_salt,passcode_hash FROM customers WHERE phone')) {
                  return customers.get(args[0]) || null;
                }
                if (sql.includes('SELECT id,name,phone FROM customers WHERE id')) {
                  return [...customers.values()].find(c => c.id === args[0]) || null;
                }
                if (sql.includes('SELECT auth_version FROM customers')) {
                  const c = [...customers.values()].find(row => row.id === args[0]);
                  return c ? { auth_version: c.auth_version || 0 } : null;
                }
                if (sql.includes('SELECT id,phone,code_hash,expires_at,attempts,consumed_at FROM customer_auth_otps')) {
                  const c = challenges.get(args[0]);
                  return c && c.phone === args[1] ? { ...c } : null;
                }
                if (sql.includes('SELECT count,window_start FROM auth_rate_limits')) {
                  const row = limits.get(args[0]);
                  return row ? { ...row } : null;
                }
                return null;
              },
              async run() {
                if (sql.startsWith('INSERT INTO auth_rate_limits')) {
                  const [key, windowStart] = args;
                  const old = limits.get(key);
                  limits.set(key, old && old.window_start === windowStart
                    ? { window_start: windowStart, count: old.count + 1 }
                    : { window_start: windowStart, count: 1 });
                } else if (sql.startsWith('UPDATE customer_auth_otps SET consumed_at=? WHERE phone=?')) {
                  const [time, phone] = args;
                  for (const c of challenges.values()) if (c.phone === phone && c.consumed_at == null) c.consumed_at = time;
                } else if (sql.startsWith('INSERT INTO customer_auth_otps')) {
                  const [id, phone, code_hash, expires_at, created_at] = args;
                  challenges.set(id, { id, phone, code_hash, expires_at, attempts: 0, consumed_at: null, created_at });
                } else if (sql.startsWith('UPDATE customer_auth_otps SET consumed_at=? WHERE id=? AND consumed_at IS NULL')) {
                  const [time, id] = args;
                  const c = challenges.get(id);
                  if (c && c.consumed_at == null) c.consumed_at = time;
                } else if (sql.startsWith('UPDATE customer_auth_otps SET attempts=')) {
                  const [attempts, threshold, time, id] = args;
                  const c = challenges.get(id);
                  if (c && c.consumed_at == null) {
                    c.attempts = attempts;
                    if (attempts >= threshold) c.consumed_at = time;
                  }
                } else if (sql.startsWith('UPDATE customer_auth_otps SET consumed_at=? WHERE id=? AND phone=?')) {
                  const [time, id, phone, now] = args;
                  const c = challenges.get(id);
                  if (c && c.phone === phone && c.consumed_at == null && c.expires_at > now && c.attempts < 5) c.consumed_at = time;
                  return { meta: { changes: c && c.consumed_at === time ? 1 : 0 } };
                } else if (sql.startsWith('UPDATE customers SET name=?')) {
                  const [name, id] = args;
                  const c = [...customers.values()].find(row => row.id === id);
                  if (c && !String(c.name || '').trim()) c.name = name;
                } else if (sql.startsWith('INSERT INTO customers (id,name,phone,whatsapp_opt_in')) {
                  const [id, name, phone] = args;
                  const existing = customers.get(phone);
                  const row = existing || { id, name, phone, passcode_salt: null, passcode_hash: null, auth_version: 0 };
                  if (!String(row.name || '').trim()) row.name = name;
                  customers.set(phone, row);
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
  return { env, customers, challenges };
}
async function request(path, body, env) {
  return handler.fetch(new Request('https://fwcoldpressed.in' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }), env, {});
}
async function issueCode(t, env, phone = '9876543210') {
  let sentCode = '';
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /graph\.facebook\.com\/v23\.0\/123456789\/messages$/);
    assert.equal(options.method, 'POST');
    assert.match(options.headers.authorization, /^Bearer test-token$/);
    const payload = JSON.parse(options.body);
    assert.equal(payload.messaging_product, 'whatsapp');
    assert.equal(payload.to, '91' + phone);
    assert.equal(payload.type, 'template');
    assert.equal(payload.template.name, 'freshway_login_otp');
    sentCode = payload.template.components.find(c => c.type === 'body').parameters[0].text;
    assert.match(sentCode, /^\d{6}$/);
    return Response.json({ messages: [{ id: 'wamid.test' }] }, { status: 200 });
  });
  const response = await request('/api/auth/otp/start', { phone }, env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.challengeId);
  assert.match(payload.phone, /\d{4}$/);
  assert.equal(mock.mock.callCount(), 1);
  return { challengeId: payload.challengeId, code: sentCode };
}

test('existing customer can log in with WhatsApp OTP and receive a secure session', async t => {
  const existing = { id: 'customer-1', name: 'Existing Customer', phone: '919876543210', passcode_salt: 'legacy', passcode_hash: 'legacy', auth_version: 0 };
  const { env } = createEnv(existing);
  const { challengeId, code } = await issueCode(t, env);
  const response = await request('/api/auth/otp/verify', { phone: ' +91 9876543210 ', challengeId, code }, env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.customerId, 'customer-1');
  assert.equal(payload.name, 'Existing Customer');
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') || '', /Secure/);
});

test('new customer must verify WhatsApp OTP and provide a name before account creation', async t => {
  const { env, customers, challenges } = createEnv();
  const { challengeId, code } = await issueCode(t, env);
  const needsName = await request('/api/auth/otp/verify', { phone: '9876543210', challengeId, code }, env);
  assert.equal(needsName.status, 200);
  assert.equal((await needsName.json()).needsName, true);
  assert.equal(customers.size, 0);
  assert.equal(challenges.get(challengeId).consumed_at, null);
  const response = await request('/api/auth/otp/verify', { phone: '9876543210', challengeId, code, name: 'New Customer' }, env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.customerId);
  assert.equal(payload.name, 'New Customer');
  assert.equal(customers.get('919876543210').name, 'New Customer');
  assert.notEqual(challenges.get(challengeId).consumed_at, null);
});

test('incorrect WhatsApp OTP is rejected without creating an account', async t => {
  const { env, customers } = createEnv();
  const { challengeId, code } = await issueCode(t, env);
  const wrongCode = code === '000000' ? '000001' : '000000';
  const response = await request('/api/auth/otp/verify', { phone: '9876543210', challengeId, code: wrongCode }, env);
  assert.equal(response.status, 401);
  assert.equal(customers.size, 0);
});

test('WhatsApp OTP start fails safely when provider configuration is missing', async () => {
  const { env } = createEnv();
  delete env.WHATSAPP_AUTH_TEMPLATE_NAME;
  const response = await request('/api/auth/otp/start', { phone: '9876543210' }, env);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});
