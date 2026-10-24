import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePushEndpoint } from '../src/push-endpoint.js';

test('accepts documented browser push-service endpoint domains', () => {
  const endpoints = [
    'https://fcm.googleapis.com/fcm/send/test-token',
    'https://android.googleapis.com/gcm/send/test-token',
    'https://updates.push.services.mozilla.com/wpush/v2/test-token',
    'https://push.services.mozilla.com/wpush/v2/test-token',
    'https://web.push.apple.com/test-token',
    'https://wns2-example.notify.windows.com/?token=test-token',
    'https://push.opera.com/subscribe/test-token'
  ];
  for (const endpoint of endpoints) {
    assert.equal(validatePushEndpoint(endpoint), new URL(endpoint).toString());
  }
});

test('rejects arbitrary HTTPS destinations and common SSRF targets', () => {
  for (const endpoint of [
    'https://attacker.example/push',
    'https://fcm.googleapis.com.attacker.example/push',
    'https://127.0.0.1/admin',
    'https://[::1]/admin',
    'https://169.254.169.254/latest/meta-data',
    'http://fcm.googleapis.com/fcm/send/test-token',
    'https://fcm.googleapis.com:8443/fcm/send/test-token',
    'https://user@fcm.googleapis.com/fcm/send/test-token',
    'https://fcm.googleapis.com/fcm/send/test-token#fragment',
    'https://fcm.googleapis.com./fcm/send/test-token',
    ' '
  ]) {
    assert.throws(() => validatePushEndpoint(endpoint), /Invalid push endpoint/i, endpoint);
  }
});

test('rejects overlong endpoint values before persisting or sending', () => {
  assert.throws(() => validatePushEndpoint('https://fcm.googleapis.com/' + 'x'.repeat(2050)), /Invalid push endpoint/i);
});
