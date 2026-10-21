import test from 'node:test';
import assert from 'node:assert/strict';
import adminAuth from '../src/admin-auth.js';

function responseDb() {
  const sqlCalls = [];
  return {
    sqlCalls,
    prepare(sql) {
      sqlCalls.push(sql);
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes('SELECT count,window_start FROM auth_rate_limits')) return null;
              return null;
            },
            async all() {
              if (sql.includes('FROM notification_events')) return { results: [] };
              return { results: [] };
            },
            async run() { return { meta: { changes: 1 }, values }; }
          };
        },
        async run() { return { meta: { changes: 1 }, values: [] }; }
      };
    },
    async batch() { return [] }
  };
}

const baseEnv = () => ({
  ADMIN_TOKEN: 'test-admin-token',
  ['ADMIN_SESSION_SECRET']: ['test-admin-session-secret-', 'with-enough-entropy'].join(''),
  APP_ORIGIN: 'https://fwcoldpressed.in',
  APP_ORIGINS: 'https://fwcoldpressed.in',
  ['VAPID_PUBLIC_KEY']: 'public-vapid-key',
  ['VAPID_PRIVATE_KEY']: 'private-vapid-key',
  ['VAPID_SUBJECT']: 'mailto:alerts@fwcoldpressed.in',
  DB: responseDb()
});

async function signedIn(env) {
  const login = await adminAuth.fetch(new Request('https://fwcoldpressed.in/api/admin/login', {
    method: 'POST', headers: { Origin: 'https://fwcoldpressed.in', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: env.ADMIN_TOKEN })
  }), env, { waitUntil() {} });
  assert.equal(login.status, 200);
  return login.headers.get('set-cookie').split(';')[0];
}

test('Owner API CORS allows the DELETE method required to disable push alerts', async () => {
  const env = baseEnv();
  const response = await adminAuth.fetch(new Request('https://fwcoldpressed.in/api/admin/push/subscribe', {
    method: 'OPTIONS', headers: { Origin: 'https://fwcoldpressed.in' }
  }), env, { waitUntil() {} });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-methods') || '', /DELETE/);
});

test('Owner push endpoints require the signed Owner session', async () => {
  const env = baseEnv();
  const response = await adminAuth.fetch(new Request('https://fwcoldpressed.in/api/admin/push/subscribe', {
    method: 'POST', headers: { Origin: 'https://fwcoldpressed.in', 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: { endpoint: 'https://push.example/sub', keys: { p256dh: 'p', auth: 'a' } } })
  }), env, { waitUntil() {} });
  assert.equal(response.status, 401);
});

test('signed Owner can read push configuration, subscribe/unsubscribe and read transactional alert history', async () => {
  const env = baseEnv();
  const cookie = await signedIn(env);
  const request = (path, init = {}) => adminAuth.fetch(new Request(`https://fwcoldpressed.in${path}`, {
    ...init, headers: { Origin: 'https://fwcoldpressed.in', Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers || {}) }
  }), env, { waitUntil() {} });

  const keyResponse = await request('/api/admin/push/public-key');
  assert.equal(keyResponse.status, 200);
  assert.deepEqual(await keyResponse.json(), {
    publicKey: 'public-vapid-key',
    pushConfigured: true,
    ownerSubscriptionCount: 0,
    latestAlert: null
  });

  const subscription = { endpoint: 'https://push.example/owner-device', keys: { p256dh: 'p256dh-key', auth: 'auth-key' }, expirationTime: null };
  const subscribe = await request('/api/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  assert.equal(subscribe.status, 200);
  assert.match(env.DB.sqlCalls.join('\n'), /owner_push_subscriptions/);

  const history = await request('/api/admin/order-alerts?limit=10');
  assert.equal(history.status, 200);
  assert.deepEqual(await history.json(), { alerts: [], hasMore: false, nextBefore: null });

  const deleteOne = await request('/api/admin/order-alerts/42', { method: 'DELETE' });
  assert.equal(deleteOne.status, 200);
  assert.deepEqual(await deleteOne.json(), { ok: true, deleted: 1 });
  const deleteAll = await request('/api/admin/order-alerts', { method: 'DELETE' });
  assert.equal(deleteAll.status, 200);
  assert.deepEqual(await deleteAll.json(), { ok: true, deleted: 1 });
  const deleteQueries = env.DB.sqlCalls.filter(sql => /^\s*DELETE FROM notification_events/i.test(sql));
  assert.equal(deleteQueries.length, 2);
  assert.match(deleteQueries[0], /WHERE id=\? AND audience='owner'/);
  assert.match(deleteQueries[1], /WHERE audience='owner'/);
  assert.doesNotMatch(deleteQueries.join(' '), /customer_id|owner_push_subscriptions/i);
  const unsubscribe = await request('/api/admin/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  assert.equal(unsubscribe.status, 200);
  assert.match(env.DB.sqlCalls.join('\n'), /DELETE FROM owner_push_subscriptions/);
});
