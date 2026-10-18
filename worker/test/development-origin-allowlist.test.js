import test from 'node:test';
import assert from 'node:assert/strict';
import customerAuth from '../src/passcode-auth.js';
import production from '../src/admin-auth.js';

const PREVIEW = 'https://feature-branch.freshway-f32.pages.dev';
const DEV_ENV = {
  FRESHWAY_ENVIRONMENT: 'development',
  APP_ORIGIN: 'http://localhost:8788',
  APP_ORIGINS: 'http://localhost:8788,http://127.0.0.1:8788,http://localhost:8787,http://127.0.0.1:8787',
  APP_ORIGIN_SUFFIXES: '.freshway-f32.pages.dev',
  ADMIN_TOKEN: 'fixture-admin',
  CUSTOMER_SESSION_SECRET: 'fixture-customer-session',
  ADMIN_SESSION_SECRET: 'fixture-admin-session',
  DB: { prepare() { throw new Error('Database must not be touched by origin/CORS tests'); } }
};

function makeRequest(path, origin, method = 'OPTIONS') {
  return new Request(`https://freshway-api-dev.workers.dev${path}`, {
    method,
    headers: { Origin: origin }
  });
}

test('development customer API accepts a branch preview origin with the exact Pages suffix', async () => {
  const response = await customerAuth.fetch(makeRequest('/api/auth/register', PREVIEW), DEV_ENV, {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), PREVIEW);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('development owner API accepts a branch preview origin with the exact Pages suffix', async () => {
  const response = await production.fetch(makeRequest('/api/admin/status', PREVIEW, 'GET'), DEV_ENV, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), PREVIEW);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('preview suffix matching rejects lookalike, bare production and non-HTTPS origins', async () => {
  for (const origin of [
    'https://freshway-f32.pages.dev.evil.example',
    'https://freshway-f32.pages.dev',
    'http://feature-branch.freshway-f32.pages.dev'
  ]) {
    const response = await customerAuth.fetch(makeRequest('/api/auth/register', origin), DEV_ENV, {});
    assert.equal(response.status, 403, `unexpectedly accepted ${origin}`);
  }
});

test('production Worker rejects an explicit development environment marker even without an Origin header', async () => {
  const productionEnv = { ...DEV_ENV, FRESHWAY_ENVIRONMENT: 'production' };
  delete productionEnv.APP_ORIGIN_SUFFIXES;
  const request = new Request('https://freshway-api.all-in-one-all.workers.dev/api/health', {
    headers: { 'X-Freshway-Environment': 'development' }
  });
  const response = await production.fetch(request, productionEnv, {});
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /environment mismatch/i);
});

test('development Worker rejects a production environment marker', async () => {
  const request = new Request('https://freshway-api-dev.workers.dev/api/health', {
    headers: { 'X-Freshway-Environment': 'production' }
  });
  const response = await production.fetch(request, DEV_ENV, {});
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /environment mismatch/i);
});

test('production Worker still rejects branch-preview origins', async () => {
  const productionEnv = {
    ...DEV_ENV,
    APP_ORIGIN: 'https://fwcoldpressed.in',
    APP_ORIGINS: 'https://fwcoldpressed.in,https://freshway-f32.pages.dev'
  };
  delete productionEnv.APP_ORIGIN_SUFFIXES;
  const response = await customerAuth.fetch(makeRequest('/api/auth/register', PREVIEW), productionEnv, {});
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /origin not allowed/i);
});
