const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('admin.html', 'utf8');
const source = fs.readFileSync('frontend/admin/order-alerts.js', 'utf8');
const adminUi = fs.readFileSync('admin.js', 'utf8');
const worker = fs.readFileSync('admin/sw.js', 'utf8');
const route = fs.readFileSync('worker/src/admin-auth.js', 'utf8');

assert.match(html, /id="ownerOrderAlertToggle"/);
assert.match(html, /id="ownerOrderAlertStatus"/);
assert.match(html, /id="ownerOrderAlertList"/);
assert.match(html, /frontend\/admin\/order-alerts\.js\?v=20261020-owner-push-login-ready-v2/);
assert.match(source, /Notification\.requestPermission\(\)/);
assert.match(source, /pushManager\.subscribe/);
assert.match(source, /Notification\.permission === 'granted' && !automaticSetupAttempted/);
assert.match(source, /freshway:admin-authenticated/);
assert.match(adminUi, /freshway:admin-authenticated/);
assert.match(source, /Finish enabling Owner alerts/);
assert.match(source, /Owner needs its own push subscription/);
assert.match(source, /\/admin\/push\/subscribe/);
assert.match(source, /\/admin\/order-alerts\?limit=25/);
assert.match(source, /Disable alerts on this device/);
assert.match(worker, /addEventListener\('push'/);
assert.match(worker, /addEventListener\('notificationclick'/);
assert.match(worker, /fw-owner-v18/);
assert.match(route, /\/api\/admin\/push\/public-key/);
assert.match(route, /\/api\/admin\/push\/subscribe/);
assert.match(route, /\/api\/admin\/order-alerts/);
 (async () => {
  const calls = [];
  let authenticated = false;
  const windowListeners = new Map();
  const button = { disabled: false, textContent: '', dataset: { enabled: '0' }, addEventListener() {} };
  const status = { textContent: '' };
  const document = {
    readyState: 'complete',
    querySelector(selector) {
      if (selector === '#ownerOrderAlertToggle') return button;
      if (selector === '#ownerOrderAlertStatus') return status;
      return null;
    },
    addEventListener() {}
  };
  const subscriptionJson = {
    endpoint: 'https://push.example/owner-device',
    keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
    expirationTime: null
  };
  const registration = {
    active: { state: 'activated' },
    pushManager: {
      async getSubscription() { return null; },
      async subscribe(options) {
        assert.equal(options.userVisibleOnly, true);
        assert.equal(options.applicationServerKey.length, 3);
        return { endpoint: subscriptionJson.endpoint, toJSON: () => subscriptionJson };
      }
    }
  };
  const testNotification = { permission: 'granted', requestPermission: async () => 'granted' };
  const window = {
    PushManager: function PushManager() {},
    Notification: testNotification,
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    api: async (path, options = {}) => {
      calls.push({ path, options });
      if (!authenticated) throw new Error('Unauthorized');
      if (path === '/admin/push/public-key') return { publicKey: 'AQID', pushConfigured: true };
      if (path === '/admin/push/subscribe') return { ok: true };
      throw new Error('Unexpected Owner API request: ' + path);
    }
  };
  const navigator = {
    serviceWorker: {
      async getRegistration() { return null; },
      async register(path, options) {
        assert.equal(path, '/admin/sw.js');
        assert.equal(options.scope, '/admin/');
        return registration;
      }
    }
  };
  vm.runInNewContext(source, {
    document, window, navigator,
    Notification: testNotification,
    MutationObserver: class { observe() {} },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    console
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(button.dataset.enabled, '0', 'Owner alerts must wait until a signed-in session exists');
  authenticated = true;
  const signedInHandler = windowListeners.get('freshway:admin-authenticated');
  assert.equal(typeof signedInHandler, 'function', 'successful Owner sign-in must trigger an alert setup retry');
  signedInHandler();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(button.dataset.enabled, '1', 'Owner subscription should be provisioned after sign-in when origin permission is already granted');
  assert.equal(button.textContent, 'Disable alerts on this device');
  const saveCall = calls.find(call => call.path === '/admin/push/subscribe');
  assert.ok(saveCall, 'Owner subscription must be registered on the server');
  assert.equal(saveCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(saveCall.options.body).subscription, subscriptionJson);
  console.log('Owner transactional notification controls and push worker contract OK (including auto-provision after sign-in when permission is already granted)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
