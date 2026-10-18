import test from 'node:test';
import assert from 'node:assert/strict';
import customerAuth from '../src/passcode-auth.js';
import production from '../src/admin-auth.js';

const ROOT = 'https://fwcoldpressed.in';
const PAGES = 'https://freshway-f32.pages.dev';
const env = {
  APP_ORIGIN: ROOT,
  APP_ORIGINS: `${ROOT},${PAGES}`,
  ADMIN_TOKEN: 'fixture-admin',
  CUSTOMER_SESSION_SECRET: 'test-customer',
  ADMIN_SESSION_SECRET: 'test-admin',
  DB: { prepare() { throw new Error('DB must not be touched by origin/CORS tests'); } }
};

function makeRequest(path, origin, method = 'OPTIONS') {
  return new Request(`https://freshway-api.all-in-one-all.workers.dev${path}`, {
    method,
    headers: { Origin: origin }
  });
}

test('customer auth preflight accepts the FreshWay custom domain and returns the matching CORS origin', async () => {
  const response = await customerAuth.fetch(makeRequest('/api/auth/register', ROOT), env, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), ROOT);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('customer auth preflight keeps the existing Pages domain working', async () => {
  const response = await customerAuth.fetch(makeRequest('/api/auth/register', PAGES), env, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), PAGES);
});

test('customer auth still rejects untrusted origins', async () => {
  const response = await customerAuth.fetch(makeRequest('/api/auth/register', 'https://evil.example'), env, {});
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /origin not allowed/i);
});

test('production Worker returns matching CORS headers when forwarding customer requests for either trusted origin', async () => {
  for (const origin of [ROOT, PAGES]) {
    const response = await production.fetch(makeRequest('/api/auth/session', origin, 'GET'), env, {});
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('vary') || '', /origin/i);
  }
});

test('production Worker rejects untrusted origins before forwarding requests', async () => {
  const response = await production.fetch(makeRequest('/api/auth/session', 'https://evil.example', 'GET'), env, {});
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /origin not allowed/i);
});
