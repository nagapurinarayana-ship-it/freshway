const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('notifications.js', 'utf8');

async function makeHarness({
  permission = 'default',
  requestResult = 'granted',
  customerId = 'customer-123',
  initiallySubscribed = false,
  supported = true,
  standalone = false,
  sessionDelayMs = 0
} = {}) {
  const storage = new Map();
  if (customerId) storage.set('freshway-customer-id', customerId);
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const calls = [];
  let permissionValue = permission;
  let requestPermissionCalls = 0;
  let subscription = initiallySubscribed ? {
    endpoint: 'https://fcm.googleapis.com/freshway-test-endpoint',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'test-key', auth: 'test-auth' } }; }
  } : null;
  const notificationApi = {
    get permission() { return permissionValue; },
    set permission(value) { permissionValue = value; },
    async requestPermission() {
      requestPermissionCalls += 1;
      permissionValue = requestResult;
      return requestResult;
    }
  };
  const registration = {
    pushManager: {
      async getSubscription() { return subscription; },
      async subscribe(options) {
        calls.push({ type: 'push-subscribe', options });
        assert.equal(options.userVisibleOnly, true);
        subscription = {
          endpoint: 'https://fcm.googleapis.com/freshway-test-endpoint',
          toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'test-key', auth: 'test-auth' } }; }
        };
        return subscription;
      }
    }
  };
  const navigator = {
    ...(supported ? {
      serviceWorker: {
        async register(path, options) {
          calls.push({ type: 'service-worker-register', path, options });
          return registration;
        },
        async getRegistration(scope) {
          assert.equal(scope, '/');
          return registration;
        },
        ready: Promise.resolve(registration)
      }
    } : {})
  };
  const window = {
    ...(supported ? { Notification: notificationApi, PushManager: function PushManager() {} } : {}),
    navigator,
    matchMedia: () => ({ matches: standalone }),
    addEventListener() {},
    location: { reload() {} }
  };
  const document = {
    readyState: 'complete',
    addEventListener() {},
    dispatchEvent() {},
    querySelector() { return null; }
  };
  const sessionData = () => customerId ? { customerId, registeredPhone: '9876543210', name: 'Test Customer' } : {};
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  });
  const fetch = async (path, options = {}) => {
    calls.push({ type: 'fetch', path, options });
    if (path === '/api/auth/session') {
      if (sessionDelayMs > 0) await new Promise(resolve => setTimeout(resolve, sessionDelayMs));
      return response(sessionData());
    }
    if (path === '/api/push/public-key') return response({ publicKey: 'AQID' });
    if (path === '/api/push/subscribe') return response({ ok: true });
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/customers/register') return response({ ok: true });
    return response({ error: 'Unexpected request: ' + path }, 404);
  };
  const context = {
    window, navigator, document, localStorage, fetch,
    ...(supported ? { Notification: notificationApi } : {}),
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    console: { log() {}, warn() {}, error() {} },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    URL
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    service: window.FreshWayNotifications,
    localStorage,
    calls,
    get permission() { return permissionValue; },
    get requestPermissionCalls() { return requestPermissionCalls; },
    get subscription() { return subscription; }
  };
}

(async () => {
  {
    const h = await makeHarness({ permission: 'default' });
    const state = await h.service.getStatus();
    assert.equal(state.state, 'not-enabled');
    assert.equal(state.permission, 'default');
    assert.match(state.label, /enable order and delivery updates/i);
    assert.equal(h.requestPermissionCalls, 0, 'reading permission status must never prompt the user');
  }
  {
    const h = await makeHarness({ permission: 'denied' });
    const state = await h.service.getStatus();
    assert.equal(state.state, 'blocked');
    assert.match(state.label, /browser settings/i);
    const error = await h.service.enable().then(() => null, value => value);
    assert.equal(error.code, 'NOTIFICATION_PERMISSION_DENIED');
    assert.equal(h.requestPermissionCalls, 0, 'a denied permission must not trigger repeated prompts');
  }
  {
    const h = await makeHarness({ permission: 'denied', standalone: true });
    const state = await h.service.getStatus();
    assert.equal(state.state, 'blocked');
    assert.match(state.label, /Android app settings/i);
  }
  {
    const h = await makeHarness({ permission: 'granted', initiallySubscribed: false });
    const before = await h.service.getStatus();
    assert.equal(before.state, 'setup-required', 'granted permission alone is not a completed push subscription');
    await h.service.enable();
    assert.equal(h.requestPermissionCalls, 0, 'already-granted permission must not be requested again');
    assert.equal(h.localStorage.getItem('freshway-push-enabled'), '1');
    const after = await h.service.getStatus();
    assert.equal(after.state, 'enabled');
    assert.equal(after.permission, 'granted');
  }
  {
    const h = await makeHarness({ permission: 'default', requestResult: 'granted' });
    await h.service.getStatus();
    assert.equal(h.requestPermissionCalls, 0, 'status refresh must not request permission');
    await h.service.enable();
    assert.equal(h.requestPermissionCalls, 1);
    assert.equal(h.permission, 'granted');
    assert.equal((await h.service.getStatus()).state, 'enabled');
    const registration = h.calls.find(call => call.type === 'service-worker-register' && call.options);
    assert.deepEqual(JSON.parse(JSON.stringify(registration.options)), { scope: '/', updateViaCache: 'none' });
  }
  {
    const h = await makeHarness({ permission: 'default', requestResult: 'denied' });
    const error = await h.service.enable().then(() => null, value => value);
    assert.equal(error.code, 'NOTIFICATION_PERMISSION_DENIED');
    assert.equal(h.requestPermissionCalls, 1);
    assert.equal((await h.service.getStatus()).state, 'blocked');
    assert.equal(h.localStorage.getItem('freshway-push-enabled'), null);
  }
  {
    const h = await makeHarness({ permission: 'default', customerId: null });
    const state = await h.service.getStatus();
    assert.equal(state.state, 'login-required');
    const error = await h.service.enable().then(() => null, value => value);
    assert.equal(error.code, 'NOTIFICATION_LOGIN_REQUIRED');
    assert.equal(h.requestPermissionCalls, 0, 'guests must verify their mobile before notification permission is requested');
  }
  {
    const h = await makeHarness({ supported: false });
    const state = await h.service.getStatus();
    assert.equal(state.state, 'unsupported');
    const error = await h.service.enable().then(() => null, value => value);
    assert.equal(error.code, 'NOTIFICATION_UNSUPPORTED');
  }
  {
    const h = await makeHarness({ sessionDelayMs: 20 });
    const results = await Promise.all([h.service.session(), h.service.session(), h.service.session(), h.service.session()]);
    assert.equal(results.length, 4);
    const sessionCalls = h.calls.filter(call => call.type === 'fetch' && call.path === '/api/auth/session');
    assert.equal(sessionCalls.length, 1, 'concurrent startup/session consumers must share one in-flight authentication request');
  }
  console.log('FreshWay notification permission state, prompt, subscription and recovery contracts passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
